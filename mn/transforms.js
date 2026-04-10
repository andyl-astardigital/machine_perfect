/**
 * machine_native — markup transforms.
 *
 * Structural conversion between HTML machine markup and SCXML.
 * State and context travel inside the markup — nothing is extracted or wrapped.
 * S-expressions are structural child elements, never attribute strings.
 *
 * HTML is the browser substrate. SCXML is the service substrate.
 * These transforms are the bridge. They run once at the edge.
 *
 * Rule: parentheses → elements. Bare words → attributes.
 *
 * @version 0.5.0
 * @license MIT
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory(require('./scxml'));
  } else if (typeof define === 'function' && define.amd) {
    define(['./scxml'], factory);
  } else {
    root.MPTransforms = factory(root.MPSCXML);
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function (scxml) {

  // Minimal XML attribute escaping. Only < and & MUST be escaped in attributes.
  // > is legal inside XML attribute values and must NOT be escaped — s-expressions
  // like (> amount 0) depend on it passing through literally.
  function esc(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  HTML → SCXML                                                           ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // Receives raw HTML string containing mn-* markup.
  // Produces an SCXML string with the same semantics.
  // Current state and context travel in the markup — mn-ctx becomes
  // the mn-ctx attribute on <scxml>, mn-current-state becomes SCXML initial.
  //
  // Transitions are extracted exclusively from <mn-transition> structural
  // elements. Bare mn-to attributes on buttons are UI triggers and are not
  // transported to SCXML. Lifecycle hooks (<mn-init>, <mn-exit>) are read
  // from child elements and output as mn-init/mn-exit attributes in SCXML.
  //
  // This is a TEXT transform. It does not parse into a canonical format
  // and rewrite. It reads the HTML, maps elements to SCXML, and the
  // s-expressions pass through as-is.

  function htmlToScxml(html) {
    var lines = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');

    // Extract machine id
    var mpMatch = html.match(/mn="([^"]+)"/);
    var id = mpMatch ? mpMatch[1] : 'unknown';

    // Extract initial state
    var initialMatch = html.match(/mn-initial="([^"]+)"/);
    var currentMatch = html.match(/mn-current-state="([^"]+)"/);
    var initial = currentMatch ? currentMatch[1] : (initialMatch ? initialMatch[1] : null);

    // Extract context — handles both single-quoted (server) and
    // double-quoted with entities (browser outerHTML)
    var ctxMatch = html.match(/mn-ctx='([^']*)'/) || html.match(/mn-ctx="([^"]*)"/);
    var ctx = ctxMatch ? unescapeEntities(ctxMatch[1]) : null;

    lines.push('<scxml xmlns="http://www.w3.org/2005/07/scxml"');
    lines.push('       id="' + esc(id) + '"');
    if (initial) lines.push('       initial="' + esc(initial) + '"');
    // Context travels as a single attribute — same pattern as mn-ctx in HTML.
    if (ctx) lines.push("       mn-ctx='" + ctx.replace(/'/g, '&apos;') + "'");
    lines.push('>');

    // Build a tree of states from the HTML, preserving parent-child nesting.
    // Uses div depth tracking to determine which mn-state divs are children of which.
    var stateNodes = _buildHtmlStateTree(html);

    // Merge <template mn-state-template="X"> content into corresponding state nodes.
    // The browser serialises inactive states as empty divs with transitions in a template sibling.
    var templateRegex = /<template\s+mn-state-template="([^"]+)"[^>]*>([\s\S]*?)<\/template>/g;
    var templateMatch;
    while ((templateMatch = templateRegex.exec(html)) !== null) {
      _mergeTemplateContent(stateNodes, templateMatch[1], templateMatch[2]);
    }

    for (var si = 0; si < stateNodes.length; si++) {
      _htmlStateNodeToScxml(stateNodes[si], lines, '  ');
    }

    lines.push('</scxml>');
    return lines.join('\n');
  }

  // Build a tree of state nodes from HTML by tracking div open/close depth.
  // Returns an array of top-level state nodes, each with a children array.
  function _buildHtmlStateTree(html) {
    // Find all mn-state div positions with their nesting depth
    var statePositions = [];
    var pos = 0;
    var divDepth = 0;
    while (pos < html.length) {
      var nextTag = html.indexOf('<', pos);
      if (nextTag === -1) break;
      // Skip comments
      if (html.substring(nextTag, nextTag + 4) === '<!--') {
        var commentEnd = html.indexOf('-->', nextTag + 4);
        pos = commentEnd !== -1 ? commentEnd + 3 : html.length;
        continue;
      }
      // Closing tag
      if (html[nextTag + 1] === '/') {
        var closeEnd = html.indexOf('>', nextTag);
        var closeTag = html.substring(nextTag + 2, closeEnd).trim().toLowerCase();
        if (closeTag === 'div') divDepth--;
        pos = closeEnd + 1;
        continue;
      }
      // Self-closing or opening tag — scan for attributes
      var tagEnd = nextTag + 1;
      var inQ = false;
      while (tagEnd < html.length) {
        if (html[tagEnd] === '"' || html[tagEnd] === "'") {
          if (!inQ) { inQ = html[tagEnd]; }
          else if (html[tagEnd] === inQ) { inQ = false; }
        } else if (!inQ && (html[tagEnd] === '>' || (html[tagEnd] === '/' && html[tagEnd + 1] === '>'))) {
          break;
        }
        tagEnd++;
      }
      var tagStr = html.substring(nextTag + 1, tagEnd);
      var selfClose = html[tagEnd] === '/';
      var tagNameEnd = 0;
      while (tagNameEnd < tagStr.length && !/[\s\/>]/.test(tagStr[tagNameEnd])) tagNameEnd++;
      var tagName = tagStr.substring(0, tagNameEnd).toLowerCase();

      if (tagName === 'div') {
        var mpStateMatch = tagStr.match(/mn-state="([^"]+)"/);
        if (mpStateMatch) {
          var attrs = {};
          var attrRegex = /([a-z][\w-]*)(?:="([^"]*)")?/gi;
          var am;
          while ((am = attrRegex.exec(tagStr)) !== null) {
            attrs[am[1]] = am[2] !== undefined ? unescapeEntities(am[2]) : true;
          }
          // Slice the content between this div's > and its closing </div>
          var contentStart = tagEnd + (selfClose ? 2 : 1);
          var contentEnd = _findClosingDiv(html, contentStart);
          statePositions.push({
            name: mpStateMatch[1],
            isFinal: 'mn-final' in attrs,
            attrs: attrs,
            depth: divDepth,
            content: html.substring(contentStart, contentEnd)
          });
        }
        if (!selfClose) divDepth++;
      }
      pos = tagEnd + (selfClose ? 2 : 1);
    }

    // Build tree from flat list using depth
    var roots = [];
    var stack = [];
    for (var i = 0; i < statePositions.length; i++) {
      var sp = statePositions[i];
      var node = { name: sp.name, isFinal: sp.isFinal, attrs: sp.attrs, content: sp.content, children: [] };
      while (stack.length > 0 && stack[stack.length - 1].depth >= sp.depth) stack.pop();
      if (stack.length > 0) {
        stack[stack.length - 1].node.children.push(node);
      } else {
        roots.push(node);
      }
      stack.push({ depth: sp.depth, node: node });
    }
    return roots;
  }

  // Find the matching </div> for a div that opened at the given position.
  function _findClosingDiv(html, start) {
    var depth = 1;
    var pos = start;
    while (pos < html.length && depth > 0) {
      var next = html.indexOf('<', pos);
      if (next === -1) break;
      if (html.substring(next, next + 4) === '<!--') {
        var ce = html.indexOf('-->', next + 4);
        pos = ce !== -1 ? ce + 3 : html.length;
        continue;
      }
      if (html[next + 1] === '/') {
        var cEnd = html.indexOf('>', next);
        var cTag = html.substring(next + 2, cEnd).trim().toLowerCase();
        if (cTag === 'div') depth--;
        if (depth === 0) return next;
        pos = cEnd + 1;
      } else {
        // Check if it's a div open (not self-closing)
        var oEnd = next + 1;
        var inQ2 = false;
        while (oEnd < html.length) {
          if ((html[oEnd] === '"' || html[oEnd] === "'") && !inQ2) inQ2 = html[oEnd];
          else if (html[oEnd] === inQ2) inQ2 = false;
          else if (!inQ2 && (html[oEnd] === '>' || (html[oEnd] === '/' && html[oEnd + 1] === '>'))) break;
          oEnd++;
        }
        var oTag = html.substring(next + 1, oEnd);
        var oNameEnd = 0;
        while (oNameEnd < oTag.length && !/[\s\/>]/.test(oTag[oNameEnd])) oNameEnd++;
        if (oTag.substring(0, oNameEnd).toLowerCase() === 'div' && html[oEnd] !== '/') depth++;
        pos = oEnd + (html[oEnd] === '/' ? 2 : 1);
      }
    }
    return html.length;
  }

  // Merge template content into the corresponding state node (recursive).
  function _mergeTemplateContent(nodes, name, templateContent) {
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].name === name) { nodes[i].content += templateContent; return; }
      if (nodes[i].children.length > 0) _mergeTemplateContent(nodes[i].children, name, templateContent);
    }
  }

  // Emit a single state node as SCXML, recursing into children for compound states.
  function _htmlStateNodeToScxml(node, lines, indent) {
    if (node.isFinal) {
      var finalAttrs = ' id="' + esc(node.name) + '"';
      var fInit = node.attrs['mn-init'] || null;
      var fExit = node.attrs['mn-exit'] || null;
      if (!fInit) { var fim = node.content.match(/<mn-init>([\s\S]*?)<\/mn-init>/i); if (fim) fInit = unescapeEntities(fim[1].trim()); }
      if (!fExit) { var fem = node.content.match(/<mn-exit>([\s\S]*?)<\/mn-exit>/i); if (fem) fExit = unescapeEntities(fem[1].trim()); }
      if (fInit) finalAttrs += ' mn-init="' + esc(fInit) + '"';
      if (fExit) finalAttrs += ' mn-exit="' + esc(fExit) + '"';
      lines.push(indent + '<final' + finalAttrs + '/>');
      return;
    }

    var initAttr = node.attrs['mn-init'] || null;
    var exitAttr = node.attrs['mn-exit'] || null;
    var content = node.content;

    // Compound state initial — read from HTML comment <!-- initial="X" -->
    var compoundInitial = null;
    if (node.children.length > 0) {
      var initialComment = content.match(/<!--\s*initial="([^"]+)"\s*-->/);
      if (initialComment) compoundInitial = initialComment[1];
    }

    // Strip child state div regions before extracting lifecycle hooks and transitions.
    // Without this, a parent would capture a child's <mn-init> if it appears first.
    var ownContent = content;
    for (var cci = 0; cci < node.children.length; cci++) {
      var childMarker = 'mn-state="' + node.children[cci].name + '"';
      var childIdx = ownContent.indexOf(childMarker);
      if (childIdx !== -1) {
        var divStart = ownContent.lastIndexOf('<', childIdx);
        var divEnd = _findClosingDiv(ownContent, childIdx + childMarker.length + 2);
        var closeDiv = ownContent.indexOf('>', divEnd);
        ownContent = ownContent.substring(0, divStart) + ownContent.substring(closeDiv + 1);
      }
    }

    // Extract lifecycle hooks from own content (after child stripping)
    if (!initAttr) { var ie = ownContent.match(/<mn-init>([\s\S]*?)<\/mn-init>/i); if (ie) initAttr = unescapeEntities(ie[1].trim()); }
    if (!exitAttr) { var ee = ownContent.match(/<mn-exit>([\s\S]*?)<\/mn-exit>/i); if (ee) exitAttr = unescapeEntities(ee[1].trim()); }
    var temporalEl = ownContent.match(/<mn-temporal>([\s\S]*?)<\/mn-temporal>/i);
    var temporalAttr = temporalEl ? unescapeEntities(temporalEl[1].trim()) : null;
    var whereEl = ownContent.match(/<mn-where>([\s\S]*?)<\/mn-where>/i);
    var whereAttr = whereEl ? unescapeEntities(whereEl[1].trim()) : null;
    var urlAttr = node.attrs['mn-url'] || null;
    if (!urlAttr) { var ue = ownContent.match(/<mn-url>([\s\S]*?)<\/mn-url>/i); if (ue) urlAttr = unescapeEntities(ue[1].trim()); }

    var scxmlAttrs = ' id="' + esc(node.name) + '"';
    if (initAttr) scxmlAttrs += ' mn-init="' + esc(initAttr) + '"';
    if (exitAttr) scxmlAttrs += ' mn-exit="' + esc(exitAttr) + '"';
    if (urlAttr) scxmlAttrs += ' mn-url="' + esc(urlAttr) + '"';
    if (compoundInitial) scxmlAttrs += ' initial="' + esc(compoundInitial) + '"';

    // Transitions
    var rawTransitions = extractStructuralTransitions(ownContent);
    var transitions = [];
    var seenKey = {};
    for (var di = 0; di < rawTransitions.length; di++) {
      var raw = rawTransitions[di];
      if (!raw.target && !raw.event && !raw.action && !raw.guard && !raw.emit) continue;
      var key = (raw.event || '') + '\x1f' + (raw.target || '') + '\x1f' + (raw.guard || '') + '\x1f' + (raw.action || '');
      if (seenKey.hasOwnProperty(key)) continue;
      seenKey[key] = true;
      transitions.push(raw);
    }

    var childIndent = indent + '  ';
    var hasContent = whereAttr || temporalAttr || transitions.length > 0 || node.children.length > 0;

    if (!hasContent) {
      lines.push(indent + '<state' + scxmlAttrs + '/>');
      return;
    }

    lines.push(indent + '<state' + scxmlAttrs + '>');
    if (whereAttr) lines.push(childIndent + '<mn-where><![CDATA[' + whereAttr + ']]></mn-where>');
    if (temporalAttr) lines.push(childIndent + '<mn-temporal><![CDATA[' + temporalAttr + ']]></mn-temporal>');

    for (var tii = 0; tii < transitions.length; tii++) {
      var trans = transitions[tii];
      var tAttrs = '';
      if (trans.event) tAttrs += ' event="' + esc(trans.event) + '"';
      if (trans.target) tAttrs += ' target="' + esc(trans.target) + '"';
      if (trans.guard || trans.action || trans.emit) {
        lines.push(childIndent + '<transition' + tAttrs + '>');
        if (trans.guard) lines.push(childIndent + '  <mn-guard><![CDATA[' + trans.guard + ']]></mn-guard>');
        if (trans.action) lines.push(childIndent + '  <mn-action><![CDATA[' + trans.action + ']]></mn-action>');
        if (trans.emit) lines.push(childIndent + '  <mn-emit><![CDATA[' + trans.emit + ']]></mn-emit>');
        lines.push(childIndent + '</transition>');
      } else {
        lines.push(childIndent + '<transition' + tAttrs + '/>');
      }
    }

    // Recurse into child states
    for (var ci = 0; ci < node.children.length; ci++) {
      _htmlStateNodeToScxml(node.children[ci], lines, childIndent);
    }

    lines.push(indent + '</state>');
  }


  function extractAttr(str, name) {
    var m = str.match(new RegExp(name + '="([^"]*)"')) ||
            str.match(new RegExp(name + "='([^']*)'"));
    return m ? m[1] : null;
  }

  // Extract <mn-transition> elements from HTML string.
  // Returns array of { event, target, guard, action, emit, where }.
  // CDATA sections in SCXML are unwrapped transparently.
  function extractStructuralTransitions(html) {
    var transitions = [];
    // Match both self-closing <mn-transition .../> and full <mn-transition ...>...</mn-transition>
    var re = /<mn-transition\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/mn-transition>)/gi;
    var match;
    while ((match = re.exec(html)) !== null) {
      var attrs = match[1];
      var content = match[2] || '';
      var event = extractAttr(attrs, 'event');
      var target = extractAttr(attrs, 'to');
      var guard = null, action = null, emit = null;

      var guardMatch = content.match(/<mn-guard>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/mn-guard>/i);
      if (guardMatch) guard = unescapeEntities(guardMatch[1].trim());
      var actionMatch = content.match(/<mn-action>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/mn-action>/i);
      if (actionMatch) action = unescapeEntities(actionMatch[1].trim());
      var emitMatch = content.match(/<mn-emit>([\s\S]*?)<\/mn-emit>/i);
      if (emitMatch) emit = unescapeEntities(emitMatch[1].trim());

      transitions.push({
        event: event || null,
        target: target,
        guard: guard,
        action: action,
        emit: emit
      });
    }
    return transitions;
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  SCXML state mutation                                                   ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // Mutate state and context IN PLACE on an SCXML string.
  // No full parse and rewrite. Just update the attributes.

  function updateScxmlState(scxmlString, newState, newContext) {
    var escapedState = esc(newState);
    var updated;
    if (scxmlString.indexOf('initial="') !== -1) {
      // perf: use function form — replacement string must not be interpreted for $ patterns
      updated = scxmlString.replace(/initial="[^"]*"/, function () { return 'initial="' + escapedState + '"'; });
    } else {
      updated = scxmlString.replace(/id="([^"]*)"/, function (m, idVal) {
        return 'id="' + idVal + '"\n       initial="' + escapedState + '"';
      });
    }

    if (newContext) {
      var ctxJson = JSON.stringify(newContext).replace(/'/g, '&apos;');
      if (updated.indexOf("mn-ctx='") !== -1) {
        updated = updated.replace(/mn-ctx='[^']*'/, function () { return "mn-ctx='" + ctxJson + "'"; });
      } else {
        // No mn-ctx attribute yet — insert before the closing > of the <scxml> tag
        updated = updated.replace(/(<scxml\b[^>]*?)(\s*\/?>)/, function (m, p1, p2) {
          return p1 + " mn-ctx='" + ctxJson + "'" + p2;
        });
      }
    }

    return updated;
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  SCXML → HTML                                                           ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // Converts SCXML back to HTML machine markup for the browser runtime.
  // Inverse of htmlToScxml.
  //
  // SCXML state attributes mn-init/mn-exit become <mn-init>/<mn-exit> child
  // elements in the HTML output. SCXML <transition> elements become
  // <mn-transition> structural elements with optional <mn-guard>, <mn-action>,
  // <mn-emit> children. Guard/action content is unwrapped from CDATA sections.

  // Escape < and & for HTML text content. > is safe in element content.
  function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  }

  function scxmlToHtml(scxmlString) {
    var root = scxml.parseXML(scxmlString);
    var id = root.attrs.id || root.attrs.name || 'machine';
    var initial = root.attrs.initial || null;
    var ctxStr = root.attrs['mn-ctx'] || null;

    var lines = [];
    lines.push('<div mn="' + escHtml(id) + '"');
    if (initial) lines.push('     mn-current-state="' + initial + '"');
    if (ctxStr) lines.push("     mn-ctx='" + ctxStr.replace(/'/g, '&#39;') + "'");
    lines.push('>');

    // Walk parsed tree — handles nested/compound states correctly
    for (var ci = 0; ci < root.children.length; ci++) {
      var child = root.children[ci];
      if (child.tag === 'state') _stateToHtml(child, lines, '  ');
      else if (child.tag === 'final') _finalToHtml(child, lines, '  ');
    }

    lines.push('</div>');
    return lines.join('\n');
  }

  function _getTextContent(node) {
    var text = '';
    for (var i = 0; i < node.children.length; i++) {
      if (node.children[i].tag === '#text') text += node.children[i].text;
    }
    return text.trim();
  }

  function _stateToHtml(node, lines, indent) {
    var stateName = node.attrs.id;
    if (!stateName) return;

    var mpInit = node.attrs['mn-init'] || null;
    var mpExit = node.attrs['mn-exit'] || null;
    var mpUrl = node.attrs['mn-url'] || null;
    var mpTemporal = node.attrs['mn-temporal'] || null;
    var initialChild = node.attrs.initial || null;

    lines.push(indent + '<div mn-state="' + escHtml(stateName) + '">');
    var childIndent = indent + '  ';

    // Scan children for lifecycle elements, transitions, and nested states
    var hasChildStates = false;
    for (var i = 0; i < node.children.length; i++) {
      var child = node.children[i];
      if (child.tag === 'onentry') mpInit = _getTextContent(child) || _extractActionText(child);
      else if (child.tag === 'onexit') mpExit = _getTextContent(child) || _extractActionText(child);
      else if (child.tag === 'mn-where') { lines.push(childIndent + '<mn-where>' + escHtml(_getTextContent(child)) + '</mn-where>'); }
      else if (child.tag === 'mn-temporal') { if (!mpTemporal) mpTemporal = _getTextContent(child); }
      else if (child.tag === 'state' || child.tag === 'final') hasChildStates = true;
    }

    // Emit lifecycle/temporal/url as child elements
    if (mpInit) lines.push(childIndent + '<mn-init>' + escHtml(mpInit) + '</mn-init>');
    if (mpExit) lines.push(childIndent + '<mn-exit>' + escHtml(mpExit) + '</mn-exit>');
    if (mpTemporal) lines.push(childIndent + '<mn-temporal>' + escHtml(mpTemporal) + '</mn-temporal>');
    if (mpUrl) lines.push(childIndent + '<mn-url>' + escHtml(mpUrl) + '</mn-url>');

    // Transitions
    for (var ti = 0; ti < node.children.length; ti++) {
      if (node.children[ti].tag === 'transition') {
        _transitionToHtml(node.children[ti], lines, childIndent);
      }
    }

    // Nested states (compound)
    if (hasChildStates) {
      if (initialChild) lines.push(childIndent + '<!-- initial="' + initialChild + '" -->');
      for (var si = 0; si < node.children.length; si++) {
        if (node.children[si].tag === 'state') _stateToHtml(node.children[si], lines, childIndent);
        else if (node.children[si].tag === 'final') _finalToHtml(node.children[si], lines, childIndent);
      }
    }

    lines.push(indent + '</div>');
  }

  function _extractActionText(node) {
    for (var i = 0; i < node.children.length; i++) {
      var c = node.children[i];
      if (c.tag === 'script' || c.tag === 'action' || c.tag === 'mn-action') {
        return _getTextContent(c);
      }
    }
    return null;
  }

  function _finalToHtml(node, lines, indent) {
    var stateName = node.attrs.id;
    if (!stateName) return;
    var mpInit = node.attrs['mn-init'] || null;
    var mpExit = node.attrs['mn-exit'] || null;
    if (!mpInit && !mpExit) {
      lines.push(indent + '<div mn-state="' + escHtml(stateName) + '" mn-final></div>');
    } else {
      lines.push(indent + '<div mn-state="' + escHtml(stateName) + '" mn-final>');
      if (mpInit) lines.push(indent + '  <mn-init>' + escHtml(mpInit) + '</mn-init>');
      if (mpExit) lines.push(indent + '  <mn-exit>' + escHtml(mpExit) + '</mn-exit>');
      lines.push(indent + '</div>');
    }
  }

  function _transitionToHtml(node, lines, indent) {
    var event = node.attrs.event || null;
    var target = node.attrs.target || null;
    var cond = node.attrs.cond || null;

    var guard = cond || null;
    var action = null;
    var emit = null;

    for (var i = 0; i < node.children.length; i++) {
      var child = node.children[i];
      if (child.tag === 'mn-guard') guard = _getTextContent(child) || guard;
      else if (child.tag === 'mn-action') action = _getTextContent(child);
      else if (child.tag === 'mn-emit') emit = _getTextContent(child);
    }

    var mpTransAttrs = '';
    if (event) mpTransAttrs += ' event="' + esc(event) + '"';
    if (target) mpTransAttrs += ' to="' + esc(target) + '"';

    if (guard || action || emit) {
      lines.push(indent + '<mn-transition' + mpTransAttrs + '>');
      if (guard) lines.push(indent + '  <mn-guard>' + escHtml(guard) + '</mn-guard>');
      if (action) lines.push(indent + '  <mn-action>' + escHtml(action) + '</mn-action>');
      if (emit) lines.push(indent + '  <mn-emit>' + escHtml(emit) + '</mn-emit>');
      lines.push(indent + '</mn-transition>');
    } else {
      lines.push(indent + '<mn-transition' + mpTransAttrs + '></mn-transition>');
    }
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Context extraction — read machine metadata from HTML                   ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // The markup IS the state. These functions read context, name, and current
  // state from an HTML machine string. Handles both single-quoted attributes
  // (server-rendered) and double-quoted with &quot; entities (browser outerHTML).

  function unescapeEntities(str) {
    return str.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }

  function extractContext(html) {
    var match = html.match(/mn-ctx='([^']*)'/) || html.match(/mn-ctx="([^"]*)"/);
    if (!match) return {};
    try { return JSON.parse(unescapeEntities(match[1])); }
    catch (e) { return {}; }
  }

  function extractMachine(html) {
    var nameMatch = html.match(/mn="([^"]+)"/);
    var stateMatch = html.match(/mn-current-state="([^"]+)"/);
    return {
      name: nameMatch ? nameMatch[1] : null,
      state: stateMatch ? stateMatch[1] : null,
      context: extractContext(html)
    };
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Public API                                                             ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  return {
    htmlToScxml: htmlToScxml,
    scxmlToHtml: scxmlToHtml,
    updateScxmlState: updateScxmlState,
    extractContext: extractContext,
    extractMachine: extractMachine,
    // Exported for testing — internal helpers with stable contracts
    extractStructuralTransitions: extractStructuralTransitions,
    extractAttr: extractAttr,
    version: '0.5.0'
  };
});
