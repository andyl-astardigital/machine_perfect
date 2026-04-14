/**
 * machine_native — SCXML compiler.
 *
 * Parses SCXML + MP extensions into the canonical machine definition
 * format that mn/machine.js executes. One function: XML in,
 * definition out. Zero dependencies.
 *
 *   var def = scxml.compile(xmlString, { id: 'purchase-order' });
 *   var inst = machine.createInstance(def);
 *   machine.sendEvent(inst, 'submit');
 *
 * Supported SCXML elements:
 *   <scxml initial="...">
 *   <datamodel><data id="..." expr="..."/></datamodel>
 *   <state id="...">
 *   <final id="...">
 *   <transition event="..." target="..." cond="...">
 *
 * MN extensions — xmlns:mn="http://machine-native.dev/scxml/1.0"
 * Both mn: (XML namespace) and mn- (HTML convention) prefixes are supported:
 *   <mn:guard>expr</mn:guard>      — transition guard (s-expression, bare < allowed)
 *   <mn:action>expr</mn:action>    — transition action
 *   <mn:init>expr</mn:init>        — state entry hook
 *   <mn:exit>expr</mn:exit>        — state exit hook
 *   <mn:where>expr</mn:where>      — capability-based routing
 *   <mn:temporal>expr</mn:temporal> — temporal behaviour: (animate), (after), (every)
 *   <mn:emit>name</mn:emit>        — emit inter-machine event
 *
 * S-expression content in mn: elements may contain bare < and > characters.
 * The parser reads until the closing tag without XML-parsing the content.
 * CDATA wrapping is optional (for strict XML compliance) but not required.
 *
 * @version 0.8.0
 * @license MIT
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory(require('./machine'), require('./engine'));
  } else if (typeof define === 'function' && define.amd) {
    define(['./machine', './engine'], factory);
  } else {
    root.MPSCXML = factory(root.MPMachine, root.MPEngine);
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function (machine, engine) {


  function _unescXml(str) {
    return str.replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Minimal XML parser                                                     ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // Parses a subset of XML sufficient for SCXML. Returns a tree of
  // { tag, attrs, children } nodes. No namespace resolution, no DTD, no validation.
  // Supports CDATA sections for s-expression content in guard/action elements.

  function parseXML(str) {
    var pos = 0;

    // Skip XML declaration and comments
    function skipMeta() {
      while (pos < str.length) {
        skipWhitespace();
        if (str.substring(pos, pos + 4) === '<!--') {
          pos = str.indexOf('-->', pos);
          if (pos === -1) throw new Error('[mn-scxml] unterminated comment');
          pos += 3;
        } else if (str.substring(pos, pos + 2) === '<?') {
          pos = str.indexOf('?>', pos);
          if (pos === -1) throw new Error('[mn-scxml] unterminated processing instruction');
          pos += 2;
        } else {
          break;
        }
      }
    }

    function skipWhitespace() {
      while (pos < str.length && /\s/.test(str[pos])) pos++;
    }

    function parseNode() {
      skipMeta();
      if (pos >= str.length || str[pos] !== '<') return null;
      pos++; // skip <

      // Closing tag — return null to signal end
      if (str[pos] === '/') return null;

      // Tag name
      var nameStart = pos;
      while (pos < str.length && !/[\s\/>]/.test(str[pos])) pos++;
      var tag = str.substring(nameStart, pos);

      // Attributes
      var attrs = {};
      while (pos < str.length) {
        skipWhitespace();
        if (str[pos] === '/' || str[pos] === '>') break;

        var attrStart = pos;
        while (pos < str.length && str[pos] !== '=' && !/[\s\/>]/.test(str[pos])) pos++;
        var attrName = str.substring(attrStart, pos);

        if (str[pos] === '=') {
          pos++; // skip =
          var quote = str[pos];
          if (quote === '"' || quote === "'") {
            pos++; // skip opening quote
            var valStart = pos;
            while (pos < str.length && str[pos] !== quote) pos++;
            attrs[attrName] = _unescXml(str.substring(valStart, pos));
            pos++; // skip closing quote
          }
        } else {
          attrs[attrName] = true;
        }
      }

      // Self-closing
      if (str[pos] === '/') {
        pos += 2; // skip />
        return { tag: tag, attrs: attrs, children: [] };
      }
      pos++; // skip >

      // S-expression elements: content is raw text that may contain bare < and >.
      // Read until the closing tag without trying to parse child elements.
      // Supports both mn- (HTML convention) and mn: (XML namespace convention).
      var exprTags = { 'mn-guard':1, 'mn-action':1, 'mn-init':1, 'mn-exit':1, 'mn-where':1, 'mn-temporal':1, 'mn-emit':1,
                       'mn:guard':1, 'mn:action':1, 'mn:init':1, 'mn:exit':1, 'mn:where':1, 'mn:temporal':1, 'mn:emit':1 };
      if (exprTags[tag]) {
        var closeTag = '</' + tag + '>';
        var closeIdx = str.indexOf(closeTag, pos);
        if (closeIdx === -1) throw new Error('[mn-scxml] unterminated ' + tag + ' element');
        var rawText = str.substring(pos, closeIdx).trim();
        // Strip CDATA wrapper if present (optional — authors can still use CDATA for strict XML compliance)
        if (rawText.indexOf('<![CDATA[') === 0 && rawText.indexOf(']]>') === rawText.length - 3) {
          rawText = rawText.substring(9, rawText.length - 3);
        } else {
          // Not CDATA — unescape XML entities in case author used &lt; etc.
          rawText = _unescXml(rawText);
        }
        var children = [];
        if (rawText) children.push({ tag: '#text', text: rawText, attrs: {}, children: [] });
        pos = closeIdx + closeTag.length;
        return { tag: tag, attrs: attrs, children: children };
      }

      // <content> inside <invoke> — preserve raw inner XML as a string
      if (tag === 'content') {
        var contentClose = '</content>';
        var contentEnd = str.indexOf(contentClose, pos);
        if (contentEnd === -1) throw new Error('[mn-scxml] unterminated content element');
        var rawContent = str.substring(pos, contentEnd).trim();
        pos = contentEnd + contentClose.length;
        return { tag: 'content', attrs: attrs, children: [], raw: rawContent };
      }

      // Children (standard XML parsing for non-expression elements)
      var children = [];
      while (pos < str.length) {
        skipWhitespace();
        if (pos >= str.length) break;

        if (str[pos] === '<') {
          if (str[pos + 1] === '/') {
            // Closing tag — skip past it
            pos = str.indexOf('>', pos);
            if (pos !== -1) pos++;
            break;
          }
          // Comment inside element
          if (str.substring(pos, pos + 4) === '<!--') {
            pos = str.indexOf('-->', pos);
            if (pos === -1) throw new Error('[mn-scxml] unterminated comment inside element');
            pos += 3;
            continue;
          }
          // CDATA section
          if (str.substring(pos, pos + 9) === '<![CDATA[') {
            var cdataStart = pos + 9;
            var cdataEnd = str.indexOf(']]>', cdataStart);
            if (cdataEnd === -1) throw new Error('[mn-scxml] unterminated CDATA section');
            var cdataText = str.substring(cdataStart, cdataEnd);
            children.push({ tag: '#text', text: cdataText, attrs: {}, children: [] });
            pos = cdataEnd + 3;
            continue;
          }
          var child = parseNode();
          if (child) children.push(child);
        } else {
          // Text content
          var textStart = pos;
          while (pos < str.length && str[pos] !== '<') pos++;
          var text = str.substring(textStart, pos).trim();
          if (text) children.push({ tag: '#text', text: _unescXml(text), attrs: {}, children: [] });
        }
      }

      return { tag: tag, attrs: attrs, children: children };
    }

    var root = parseNode();
    if (!root) throw new Error('[mn-scxml] no root element found');
    return root;
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  SCXML → canonical definition compiler                                  ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // Walks the parsed XML tree and produces a canonical machine definition
  // object that mn/machine.js can execute.

  function compile(xmlString, options) {
    options = options || {};
    var root = parseXML(xmlString);

    // Accept <scxml> with or without namespace prefix
    var scxmlTag = root.tag;
    if (scxmlTag !== 'scxml' && scxmlTag.indexOf(':scxml') === -1) {
      throw new Error('[mn-scxml] root element must be <scxml>, got <' + scxmlTag + '>');
    }

    var id = options.id || root.attrs.name || root.attrs.id || 'unnamed';
    var initial = root.attrs.initial || null;
    var context = {};
    var states = {};
    var projects = [];

    // mn-ctx attribute carries the full context as JSON (round-trips cleanly)
    if (root.attrs['mn-ctx']) {
      try { context = JSON.parse(root.attrs['mn-ctx']); }
      catch (e) { console.warn('[mn-scxml] failed to parse mn-ctx: ' + e.message); }
    }

    // ── Parse children ──
    for (var i = 0; i < root.children.length; i++) {
      var child = root.children[i];

      if (child.tag === 'datamodel') {
        var dataCtx = parseDatamodel(child);
        // Datamodel values fill in any gaps not covered by mn-ctx
        for (var dk in dataCtx) { if (!(dk in context)) context[dk] = dataCtx[dk]; }
      } else if (child.tag === 'state') {
        var stateSpec = parseState(child, false);
        states[stateSpec.id] = stateSpec.def;
      } else if (child.tag === 'final') {
        var finalSpec = parseState(child, true);
        states[finalSpec.id] = finalSpec.def;
      } else if (_isTag(child, 'project')) {
        var projWhen = child.attrs.when || null;
        var projExpr = _textContent(child);
        if (projExpr) projects.push({ when: projWhen, expr: projExpr, as: child.attrs.as || null });
      }
    }

    // Default initial to first state if not specified
    if (!initial) {
      var stateNames = Object.keys(states);
      if (stateNames.length > 0) initial = stateNames[0];
    }

    return machine.createDefinition({
      id: id,
      initial: initial,
      context: context,
      states: states,
      projects: projects.length > 0 ? projects : null
    });
  }


  // ── Datamodel parser ──────────────────────────────────────────────────

  function parseDatamodel(node) {
    var context = {};
    for (var i = 0; i < node.children.length; i++) {
      var data = node.children[i];
      if (data.tag !== 'data') continue;
      var dataId = data.attrs.id;
      var expr = data.attrs.expr;
      if (!dataId) continue;

      // Evaluate the expr as an s-expression to get the initial value
      // Simple literals: 'hello', 42, nil, true, false, [], {}
      if (expr) {
        context[dataId] = evalInitialValue(expr);
      } else {
        context[dataId] = null;
      }
    }
    return context;
  }

  // Evaluate a datamodel expr to a JS value.
  // Supports: 'string', number, nil, true, false, [], (obj ...)
  function evalInitialValue(expr) {
    var trimmed = expr.trim();
    if (trimmed === 'nil') return null;
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (!isNaN(Number(trimmed)) && trimmed !== '') return Number(trimmed);
    if (trimmed.charAt(0) === "'" && trimmed.charAt(trimmed.length - 1) === "'") return trimmed.slice(1, -1);
    if (trimmed === '[]') return [];
    if (trimmed === '{}') return {};
    // For complex expressions, use the engine
    try {
      return engine.eval(trimmed, {}, null, null);
    } catch (e) {
      return trimmed;
    }
  }


  // ── Tag matching ───────────────────────────────────────────────────────
  //
  // MN extensions use either mn- (HTML convention) or mn: (XML namespace).
  // This helper matches both: _isTag(node, 'guard') matches mn-guard and mn:guard.

  function _isTag(node, name) {
    return node.tag === 'mn-' + name || node.tag === 'mn:' + name;
  }

  function _textContent(node) {
    var text = '';
    for (var i = 0; i < node.children.length; i++) {
      if (node.children[i].tag === '#text') text += node.children[i].text;
    }
    return text.trim() || null;
  }


  // ── State parser ──────────────────────────────────────────────────────

  function parseState(node, isFinal) {
    var stateId = node.attrs.id;
    if (!stateId) throw new Error('[mn-scxml] <state> or <final> missing id attribute');

    var def = {};
    if (isFinal) def.final = true;

    // MP extensions on the state element
    if (node.attrs['mn-init']) def.init = node.attrs['mn-init'];
    if (node.attrs['mn-exit']) def.exit = node.attrs['mn-exit'];
    if (node.attrs['mn-url']) def.url = node.attrs['mn-url'];

    // mn-temporal: browser-evaluated temporal expression (animate, after, every)
    // Stored on the definition so it round-trips through compile → snapshot → HTML.
    if (node.attrs['mn-temporal']) def.temporal = node.attrs['mn-temporal'];

    // Temporal behaviour
    if (node.attrs['mn-after']) {
      def.after = {
        ms: parseInt(node.attrs['mn-after'], 10),
        target: node.attrs['mn-after-target'] || null
      };
    }
    if (node.attrs['mn-every']) {
      def.every = {
        ms: parseInt(node.attrs['mn-every'], 10),
        action: node.attrs['mn-every-action'] || null
      };
    }

    // Parse child elements
    var transitions = {};
    var childStates = {};
    for (var i = 0; i < node.children.length; i++) {
      var child = node.children[i];

      if (child.tag === 'transition') {
        var transition = parseTransition(child);
        var eventName = transition.event || '__auto';
        if (!transitions[eventName]) transitions[eventName] = [];
        transitions[eventName].push(transition.def);
      } else if (child.tag === 'state') {
        var childSpec = parseState(child, false);
        childStates[childSpec.id] = childSpec.def;
      } else if (child.tag === 'final') {
        var childFinal = parseState(child, true);
        childStates[childFinal.id] = childFinal.def;
      } else if (child.tag === 'onentry') {
        if (def.init) console.warn('[mn-scxml] state "' + stateId + '" has both mn-init attribute and <onentry> child — <onentry> takes precedence');
        def.init = extractActions(child);
      } else if (child.tag === 'onexit') {
        if (def.exit) console.warn('[mn-scxml] state "' + stateId + '" has both mn-exit attribute and <onexit> child — <onexit> takes precedence');
        def.exit = extractActions(child);
      } else if (_isTag(child, 'where')) {
        var whereVal = _textContent(child);
        if (whereVal) def.where = whereVal;
      } else if (_isTag(child, 'temporal')) {
        var temporalVal = _textContent(child);
        if (temporalVal) def.temporal = temporalVal;
      } else if (_isTag(child, 'init')) {
        def.init = _textContent(child);
      } else if (_isTag(child, 'exit')) {
        def.exit = _textContent(child);
      }
    }

    if (Object.keys(transitions).length > 0) def.on = transitions;
    if (Object.keys(childStates).length > 0) {
      def.states = childStates;
      def.initial = node.attrs.initial || Object.keys(childStates)[0];
    }

    // Parse <invoke type="scxml"> children — child machines embedded in this state
    var invokes = [];
    for (var ii = 0; ii < node.children.length; ii++) {
      var invokeNode = node.children[ii];
      if (invokeNode.tag === 'invoke' && invokeNode.attrs.type === 'scxml') {
        var invokeId = invokeNode.attrs.id || null;
        var invokeSrc = invokeNode.attrs.src || null;

        if (invokeSrc) {
          // src="machine-name" — load from storage at runtime
          var invokeState = invokeNode.attrs['mn-state'] || null;
          invokes.push({ id: invokeId, src: invokeSrc, state: invokeState });
        } else {
          // Inline <content> — embedded SCXML
          for (var ci = 0; ci < invokeNode.children.length; ci++) {
            if (invokeNode.children[ci].tag === 'content') {
              var contentNode = invokeNode.children[ci];
              var nestedScxml = contentNode.raw || _textContent(contentNode);
              if (nestedScxml) {
                invokes.push({ id: invokeId, scxml: nestedScxml.trim() });
              }
            }
          }
        }
      }
    }
    if (invokes.length > 0) def.invokes = invokes;

    return { id: stateId, def: def };
  }


  // ── Transition parser ─────────────────────────────────────────────────
  //
  // Parses a <transition> element from SCXML XML.
  //   target="stateName"         — bare state name, simple transition
  //   cond="expr"                — SCXML standard condition (guard)
  //   <mn-guard>expr</mn-guard>  — structural child guard
  //   <mn-action>expr</mn-action>— structural child action
  //   <mn-emit>name</mn-emit>    — structural child emit

  function parseTransition(node) {
    var event = node.attrs.event || null;
    var target = node.attrs.target || null;

    var def = {};

    def.target = target || null;
    if (node.attrs.cond) def.guard = node.attrs.cond;

    // Structural child elements: <mn:guard>/<mn-guard>, <mn:action>/<mn-action>, <mn:emit>/<mn-emit>
    for (var ci = 0; ci < node.children.length; ci++) {
      var child = node.children[ci];
      if (_isTag(child, 'guard')) {
        var guardText = _textContent(child);
        if (guardText) def.guard = guardText;
      }
      if (_isTag(child, 'action')) {
        var actionText = _textContent(child);
        if (actionText) def.action = actionText;
      }
      if (_isTag(child, 'emit')) {
        var emitText = _textContent(child);
        if (emitText) def.emit = emitText;
      }
    }

    // Where: capability-based routing (on transitions)
    if (node.attrs['mn-where']) {
      def.where = node.attrs['mn-where'];
    }

    return { event: event, def: def };
  }


  // ── Action extraction ─────────────────────────────────────────────────
  //
  // Extracts action from child elements like <script> or <action>.
  // Returns an s-expression string or null.

  function extractActions(node) {
    for (var i = 0; i < node.children.length; i++) {
      var child = node.children[i];
      if (child.tag === 'script' || child.tag === 'action' || _isTag(child, 'action')) {
        return _textContent(child);
      }
    }
    return null;
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Public API                                                             ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  return {
    compile: compile,
    parseXML: parseXML,
    version: '0.8.0'
  };
});
