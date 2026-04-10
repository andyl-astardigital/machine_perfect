/**
 * machine_perfect — SCXML compiler.
 *
 * Parses SCXML + MP extensions into the canonical machine definition
 * format that mp/machine.js executes. One function: XML in,
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
 * MP extensions (mp- attributes, same prefix as HTML):
 *   <mp-guard>expr</mp-guard>    — transition guard (child element)
 *   <mp-action>expr</mp-action>  — transition action (child element)
 *   <mp-init>expr</mp-init>        — state entry hook
 *   <mp-exit>expr</mp-exit>        — state exit hook
 *   <mp-where>expr</mp-where>      — capability-based routing
 *   <mp-temporal>expr</mp-temporal> — temporal behaviour: (animate), (after), (every)
 *
 * @version 0.5.0
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
  // { tag, attrs, children } nodes. No namespace resolution, no DTD,
  // Supports CDATA sections for s-expression content in guard/action elements.

  function parseXML(str) {
    var pos = 0;

    // Skip XML declaration and comments
    function skipMeta() {
      while (pos < str.length) {
        skipWhitespace();
        if (str.substring(pos, pos + 4) === '<!--') {
          pos = str.indexOf('-->', pos);
          if (pos === -1) throw new Error('[mp-scxml] unterminated comment');
          pos += 3;
        } else if (str.substring(pos, pos + 2) === '<?') {
          pos = str.indexOf('?>', pos);
          if (pos === -1) throw new Error('[mp-scxml] unterminated processing instruction');
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

      // Children
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
            if (pos === -1) throw new Error('[mp-scxml] unterminated comment inside element');
            pos += 3;
            continue;
          }
          // CDATA section
          if (str.substring(pos, pos + 9) === '<![CDATA[') {
            var cdataStart = pos + 9;
            var cdataEnd = str.indexOf(']]>', cdataStart);
            if (cdataEnd === -1) throw new Error('[mp-scxml] unterminated CDATA section');
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
    if (!root) throw new Error('[mp-scxml] no root element found');
    return root;
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  SCXML → canonical definition compiler                                  ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // Walks the parsed XML tree and produces a canonical machine definition
  // object that mp/machine.js can execute.

  function compile(xmlString, options) {
    options = options || {};
    var root = parseXML(xmlString);

    // Accept <scxml> with or without namespace prefix
    var scxmlTag = root.tag;
    if (scxmlTag !== 'scxml' && scxmlTag.indexOf(':scxml') === -1) {
      throw new Error('[mp-scxml] root element must be <scxml>, got <' + scxmlTag + '>');
    }

    var id = options.id || root.attrs.name || root.attrs.id || 'unnamed';
    var initial = root.attrs.initial || null;
    var context = {};
    var states = {};

    // mp-ctx attribute carries the full context as JSON (round-trips cleanly)
    if (root.attrs['mp-ctx']) {
      try { context = JSON.parse(root.attrs['mp-ctx']); }
      catch (e) { console.warn('[mp-scxml] failed to parse mp-ctx: ' + e.message); }
    }

    // ── Parse children ──
    for (var i = 0; i < root.children.length; i++) {
      var child = root.children[i];

      if (child.tag === 'datamodel') {
        var dataCtx = parseDatamodel(child);
        // Datamodel values fill in any gaps not covered by mp-ctx
        for (var dk in dataCtx) { if (!(dk in context)) context[dk] = dataCtx[dk]; }
      } else if (child.tag === 'state') {
        var stateSpec = parseState(child, false);
        states[stateSpec.id] = stateSpec.def;
      } else if (child.tag === 'final') {
        var finalSpec = parseState(child, true);
        states[finalSpec.id] = finalSpec.def;
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
      states: states
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


  // ── State parser ──────────────────────────────────────────────────────

  function parseState(node, isFinal) {
    var stateId = node.attrs.id;
    if (!stateId) throw new Error('[mp-scxml] <state> or <final> missing id attribute');

    var def = {};
    if (isFinal) def.final = true;

    // MP extensions on the state element
    if (node.attrs['mp-init']) def.init = node.attrs['mp-init'];
    if (node.attrs['mp-exit']) def.exit = node.attrs['mp-exit'];
    if (node.attrs['mp-url']) def.url = node.attrs['mp-url'];

    // mp-temporal: browser-evaluated temporal expression (animate, after, every)
    // Stored on the definition so it round-trips through compile → snapshot → HTML.
    if (node.attrs['mp-temporal']) def.temporal = node.attrs['mp-temporal'];

    // Temporal behaviour
    if (node.attrs['mp-after']) {
      def.after = {
        ms: parseInt(node.attrs['mp-after'], 10),
        target: node.attrs['mp-after-target'] || null
      };
    }
    if (node.attrs['mp-every']) {
      def.every = {
        ms: parseInt(node.attrs['mp-every'], 10),
        action: node.attrs['mp-every-action'] || null
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
        if (def.init) console.warn('[mp-scxml] state "' + stateId + '" has both mp-init attribute and <onentry> child — <onentry> takes precedence');
        def.init = extractActions(child);
      } else if (child.tag === 'onexit') {
        if (def.exit) console.warn('[mp-scxml] state "' + stateId + '" has both mp-exit attribute and <onexit> child — <onexit> takes precedence');
        def.exit = extractActions(child);
      } else if (child.tag === 'mp-where') {
        var whereText = '';
        for (var wi = 0; wi < child.children.length; wi++) {
          if (child.children[wi].tag === '#text') whereText += child.children[wi].text;
        }
        def.where = whereText.trim();
      } else if (child.tag === 'mp-temporal') {
        var temporalText = '';
        for (var ti2 = 0; ti2 < child.children.length; ti2++) {
          if (child.children[ti2].tag === '#text') temporalText += child.children[ti2].text;
        }
        if (temporalText.trim()) def.temporal = temporalText.trim();
      }
    }

    if (Object.keys(transitions).length > 0) def.on = transitions;
    if (Object.keys(childStates).length > 0) {
      def.states = childStates;
      def.initial = node.attrs.initial || Object.keys(childStates)[0];
    }

    return { id: stateId, def: def };
  }


  // ── Transition parser ─────────────────────────────────────────────────
  //
  // Parses a <transition> element from SCXML XML.
  //   target="stateName"         — bare state name, simple transition
  //   cond="expr"                — SCXML standard condition (guard)
  //   <mp-guard>expr</mp-guard>  — structural child guard
  //   <mp-action>expr</mp-action>— structural child action
  //   <mp-emit>name</mp-emit>    — structural child emit

  function parseTransition(node) {
    var event = node.attrs.event || null;
    var target = node.attrs.target || null;

    var def = {};

    def.target = target || null;
    if (node.attrs.cond) def.guard = node.attrs.cond;

    // Structural child elements: <mp-guard>, <mp-action>, <mp-emit>
    for (var ci = 0; ci < node.children.length; ci++) {
      var child = node.children[ci];
      if (child.tag === 'mp-guard') {
        var guardText = '';
        for (var gi = 0; gi < child.children.length; gi++) {
          if (child.children[gi].tag === '#text') guardText += child.children[gi].text;
        }
        if (guardText.trim()) def.guard = guardText.trim();
      }
      if (child.tag === 'mp-action') {
        var actionText = '';
        for (var ai = 0; ai < child.children.length; ai++) {
          if (child.children[ai].tag === '#text') actionText += child.children[ai].text;
        }
        if (actionText.trim()) def.action = actionText.trim();
      }
      if (child.tag === 'mp-emit') {
        var emitText = '';
        for (var ei = 0; ei < child.children.length; ei++) {
          if (child.children[ei].tag === '#text') emitText += child.children[ei].text;
        }
        if (emitText.trim()) def.emit = emitText.trim();
      }
    }

    // Where: capability-based routing (on transitions)
    if (node.attrs['mp-where']) {
      def.where = node.attrs['mp-where'];
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
      if (child.tag === 'script' || child.tag === 'action' || child.tag === 'mp-action') {
        // Action text content
        for (var j = 0; j < child.children.length; j++) {
          if (child.children[j].tag === '#text') return child.children[j].text;
        }
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
    version: '0.5.0'
  };
});
