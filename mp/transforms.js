/**
 * machine_perfect — markup transforms.
 *
 * Structural conversion between HTML machine markup and SCXML.
 * S-expressions pass through untouched. State and context travel
 * inside the markup attributes — nothing is extracted or wrapped.
 *
 * HTML is the browser substrate. SCXML is the service substrate.
 * These transforms are the bridge. They run once at the edge.
 *
 * @version 0.5.0
 * @license MIT
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory(require('./engine'));
  } else if (typeof define === 'function' && define.amd) {
    define(['./engine'], factory);
  } else {
    root.MPTransforms = factory(root.MPEngine);
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function (engine) {

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
  // Receives raw HTML string containing mp-* attributes.
  // Produces an SCXML string with the same semantics.
  // Current state and context travel in the markup — mp-ctx becomes
  // <datamodel>, mp-current-state becomes SCXML initial override.
  //
  // This is a TEXT transform. It does not parse into a canonical format
  // and rewrite. It reads the HTML, maps attributes to SCXML elements,
  // and the s-expressions pass through as-is.

  function htmlToScxml(html) {
    var lines = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');

    // Extract machine id
    var mpMatch = html.match(/mp="([^"]+)"/);
    var id = mpMatch ? mpMatch[1] : 'unknown';

    // Extract initial state
    var initialMatch = html.match(/mp-initial="([^"]+)"/);
    var currentMatch = html.match(/mp-current-state="([^"]+)"/);
    var initial = currentMatch ? currentMatch[1] : (initialMatch ? initialMatch[1] : null);

    // Extract context — handles both single-quoted (server) and
    // double-quoted with entities (browser outerHTML)
    var ctxMatch = html.match(/mp-ctx='([^']*)'/) || html.match(/mp-ctx="([^"]*)"/);
    var ctx = ctxMatch ? unescapeEntities(ctxMatch[1]) : null;

    lines.push('<scxml xmlns="http://www.w3.org/2005/07/scxml"');
    lines.push('');
    lines.push('       id="' + esc(id) + '"');
    if (initial) lines.push('       initial="' + esc(initial) + '"');
    // Context travels as a single attribute — same pattern as mp-ctx in HTML.
    // Complex values (arrays of objects) survive the round-trip intact.
    if (ctx) lines.push("       mp-ctx='" + ctx.replace(/'/g, '&apos;') + "'");
    lines.push('>');

    // Extract all tags from the HTML, find state elements and their transitions
    var allTags = extractTags(html);
    var stateTags = [];
    for (var ti = 0; ti < allTags.length; ti++) {
      if (allTags[ti]['mp-state']) stateTags.push(allTags[ti]);
    }

    for (var si = 0; si < stateTags.length; si++) {
      var stateAttrsObj = stateTags[si];
      var stateName = stateAttrsObj['mp-state'];
      var isFinal = 'mp-final' in stateAttrsObj;
      var initAttr = stateAttrsObj['mp-init'] || null;
      var exitAttr = stateAttrsObj['mp-exit'] || null;

      if (isFinal) {
        lines.push('  <final id="' + esc(stateName) + '"/>');
        continue;
      }

      // Find transitions within this state's content section
      var stateStart = html.indexOf('mp-state="' + stateName + '"');
      var nextStateIdx = -1;
      for (var nsi = si + 1; nsi < stateTags.length; nsi++) {
        var idx = html.indexOf('mp-state="' + stateTags[nsi]['mp-state'] + '"', stateStart + 1);
        if (idx !== -1) { nextStateIdx = idx; break; }
      }
      var stateContent = nextStateIdx !== -1
        ? html.substring(stateStart, nextStateIdx)
        : html.substring(stateStart);

      var rawTransitions = extractTransitions(stateContent);

      // Filter and deduplicate transitions for SCXML output.
      //
      // 1. Skip targetless transitions — emit, push!, remove-where!, etc.
      //    are browser-side UI actions. Only (to ...) transitions participate
      //    in the state machine's formal graph.
      //
      // 2. Deduplicate — when template-in-DOM is active, the browser
      //    outerHTML includes both live content AND a <template> sibling,
      //    producing duplicate transitions for the active state.
      var transitions = [];
      var seenMpTo = {};
      for (var di = 0; di < rawTransitions.length; di++) {
        if (!rawTransitions[di].target) continue;
        var key = rawTransitions[di].mpTo || rawTransitions[di].target || '';
        if (seenMpTo.hasOwnProperty(key)) continue;
        seenMpTo[key] = true;
        transitions.push(rawTransitions[di]);
      }

      var urlAttr = stateAttrsObj['mp-url'] || null;

      var scxmlAttrs = ' id="' + esc(stateName) + '"';
      if (initAttr) scxmlAttrs += ' mp-init="' + esc(initAttr) + '"';
      if (exitAttr) scxmlAttrs += ' mp-exit="' + esc(exitAttr) + '"';
      if (urlAttr) scxmlAttrs += ' mp-url="' + esc(urlAttr) + '"';

      if (transitions.length > 0) {
        lines.push('  <state' + scxmlAttrs + '>');
        for (var tii = 0; tii < transitions.length; tii++) {
          var trans = transitions[tii];
          var transAttrs = '';
          if (trans.event) transAttrs += ' event="' + esc(trans.event) + '"';
          if (trans.mpTo && trans.mpTo.charAt(0) === '(') {
            // S-expression: pass through as mp-to
            transAttrs += ' mp-to="' + esc(trans.mpTo) + '"';
          } else if (trans.target) {
            // Bare target
            transAttrs += ' target="' + esc(trans.target) + '"';
          }
          if (trans.where) transAttrs += ' mp-where="' + esc(trans.where) + '"';
          lines.push('    <transition' + transAttrs + '/>');
        }
        lines.push('  </state>');
      } else {
        lines.push('  <state' + scxmlAttrs + '/>');
      }
    }

    lines.push('</scxml>');
    return lines.join('\n');
  }

  function extractAttr(tag, name) {
    var match = tag.match(new RegExp(name + '="([^"]*)"'));
    return match ? match[1] : null;
  }

  function extractTransitions(stateContent) {
    var transitions = [];
    var tags = extractTags(stateContent);
    for (var i = 0; i < tags.length; i++) {
      var attrs = tags[i];
      if (attrs['mp-to']) {
        var mpToVal = attrs['mp-to'];
        var trans = { target: null, event: null, guard: null, action: null, emit: null, where: attrs['mp-where'] || null };

        if (mpToVal.charAt(0) === '(' && engine && engine.decomposeMpTo) {
          // S-expression: decompose into canonical slots
          var slots = engine.decomposeMpTo(mpToVal);
          trans.target = slots.target;
          trans.guard = slots.guard;
          trans.action = slots.action;
          trans.emit = slots.emit;
          trans.event = attrs['mp-event'] || slots.target;
        } else {
          // Bare state name
          trans.target = mpToVal;
          trans.event = attrs['mp-event'] || mpToVal;
        }

        // Store the original mp-to for SCXML output
        trans.mpTo = mpToVal;
        transitions.push(trans);
      }
    }
    return transitions;
  }

  // Parse all opening tags in a string, extracting their attributes.
  // Handles quoted attribute values that contain > and < (s-expressions).
  function extractTags(html) {
    var tags = [];
    var pos = 0;
    while (pos < html.length) {
      var tagStart = html.indexOf('<', pos);
      if (tagStart === -1) break;
      if (html[tagStart + 1] === '/') { pos = tagStart + 1; continue; }
      // Skip HTML comments
      if (html[tagStart + 1] === '!' && html[tagStart + 2] === '-' && html[tagStart + 3] === '-') {
        var commentEnd = html.indexOf('-->', tagStart + 4);
        pos = commentEnd !== -1 ? commentEnd + 3 : html.length;
        continue;
      }

      // Parse attributes by scanning for key="value" pairs
      var attrs = {};
      var i = tagStart + 1;
      // Skip tag name
      while (i < html.length && !/[\s\/>]/.test(html[i])) i++;

      while (i < html.length) {
        // Skip whitespace
        while (i < html.length && /\s/.test(html[i])) i++;
        if (html[i] === '>' || html[i] === '/') break;

        // Attribute name
        var nameStart = i;
        while (i < html.length && html[i] !== '=' && !/[\s\/>]/.test(html[i])) i++;
        var attrName = html.substring(nameStart, i);

        if (html[i] === '=') {
          i++; // skip =
          var quote = html[i];
          if (quote === '"' || quote === "'") {
            i++; // skip opening quote
            var valStart = i;
            while (i < html.length && html[i] !== quote) i++;
            attrs[attrName] = unescapeEntities(html.substring(valStart, i));
            i++; // skip closing quote
          }
        } else {
          attrs[attrName] = true;
        }
      }

      if (Object.keys(attrs).length > 0) tags.push(attrs);
      pos = i + 1;
    }
    return tags;
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  SCXML state mutation                                                   ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // Mutate state and context IN PLACE on an SCXML string.
  // No full parse and rewrite. Just update the attributes.

  function updateScxmlState(scxmlString, newState, newContext) {
    // Update initial attribute to reflect current state
    var updated;
    if (scxmlString.indexOf('initial="') !== -1) {
      updated = scxmlString.replace(/initial="[^"]*"/, 'initial="' + esc(newState) + '"');
    } else {
      // No initial attribute yet — add it after the id attribute
      updated = scxmlString.replace(/id="([^"]*)"/, 'id="$1"\n       initial="' + esc(newState) + '"');
    }

    // Update context attribute in place
    if (newContext) {
      var ctxJson = JSON.stringify(newContext).replace(/'/g, '&apos;');
      updated = updated.replace(/mp-ctx='[^']*'/, "mp-ctx='" + ctxJson + "'");
    }

    return updated;
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  SCXML → HTML                                                           ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // Converts SCXML back to HTML machine markup for the browser.
  // Inverse of htmlToScxml.

  function scxmlToHtml(scxmlString) {
    var lines = [];

    var idMatch = scxmlString.match(/id="([^"]+)"/);
    var id = idMatch ? idMatch[1] : 'machine';
    var initialMatch = scxmlString.match(/initial="([^"]+)"/);
    var initial = initialMatch ? initialMatch[1] : null;

    // Context attribute — mp-ctx in both HTML and SCXML
    var ctxMatch = scxmlString.match(/mp-ctx='([^']*)'/) || scxmlString.match(/mp-ctx="([^"]*)"/);
    var ctxStr = ctxMatch ? unescapeEntities(ctxMatch[1]) : null;

    lines.push('<div mp="' + id + '"');
    if (initial) lines.push('     mp-current-state="' + initial + '"');
    if (ctxStr) lines.push("     mp-ctx='" + ctxStr + "'");
    lines.push('>');

    // States
    var stateRegex = /<state\s+id="([^"]+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/state>)/g;
    var stateMatch;
    while ((stateMatch = stateRegex.exec(scxmlString)) !== null) {
      var stateName = stateMatch[1];
      var stateAttrs = stateMatch[2] || '';
      var stateContent = stateMatch[3] || '';
      var stateHtmlAttrs = ' mp-state="' + stateName + '"';

      var mpInit = extractAttr(stateAttrs, 'mp-init');
      var mpExit = extractAttr(stateAttrs, 'mp-exit');
      var mpUrl = extractAttr(stateAttrs, 'mp-url');
      if (mpInit) stateHtmlAttrs += ' mp-init="' + mpInit + '"';
      if (mpExit) stateHtmlAttrs += ' mp-exit="' + mpExit + '"';
      if (mpUrl) stateHtmlAttrs += ' mp-url="' + mpUrl + '"';

      lines.push('  <div' + stateHtmlAttrs + '>');

      // Transitions within state — use extractTags for quote-aware parsing
      var transTags = extractTags(stateContent);
      for (var tti = 0; tti < transTags.length; tti++) {
        var ta = transTags[tti];
        if (!ta['target'] && !ta['event'] && !ta['mp-to']) continue;

        var mpToVal = ta['mp-to'] || null;
        var target = ta['target'] || null;
        var event = ta['event'] || null;
        var where = ta['mp-where'] || null;

        var btnAttrs = '';
        if (mpToVal) {
          // mp-to s-expression passes through unchanged
          btnAttrs = ' mp-to="' + mpToVal + '"';
        } else if (target) {
          btnAttrs = ' mp-to="' + target + '"';
        }
        if (where) btnAttrs += ' mp-where="' + where + '"';
        var label = event || target || 'action';
        lines.push('    <button' + btnAttrs + '>' + esc(label) + '</button>');
      }

      lines.push('  </div>');
    }

    // Final states
    var finalRegex = /<final\s+id="([^"]+)"\s*\/>/g;
    var finalMatch;
    while ((finalMatch = finalRegex.exec(scxmlString)) !== null) {
      lines.push('  <div mp-state="' + finalMatch[1] + '" mp-final></div>');
    }

    lines.push('</div>');
    return lines.join('\n');
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
    var match = html.match(/mp-ctx='([^']*)'/) || html.match(/mp-ctx="([^"]*)"/);
    if (!match) return {};
    try { return JSON.parse(unescapeEntities(match[1])); }
    catch (e) { return {}; }
  }

  function extractMachine(html) {
    var nameMatch = html.match(/mp="([^"]+)"/);
    var stateMatch = html.match(/mp-current-state="([^"]+)"/);
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
    version: '0.5.0'
  };
});
