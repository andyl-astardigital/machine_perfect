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
 *   mp-to="(s-expression)"       — unified transition (guard + action + target + emit)
 *   mp-init="(s-expression)"     — state entry hook
 *   mp-exit="(s-expression)"     — state exit hook
 *   mp-where="(requires 'cap')"  — capability-based routing
 *   mp-temporal="(s-expression)" — temporal behaviour: (animate), (after), (every)
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
    return str.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Minimal XML parser                                                     ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // Parses a subset of XML sufficient for SCXML. Returns a tree of
  // { tag, attrs, children } nodes. No namespace resolution, no DTD,
  // no CDATA — just elements, attributes, and text.

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
            if (pos !== -1) pos += 3;
            continue;
          }
          var child = parseNode();
          if (child) children.push(child);
        } else {
          // Text content
          var textStart = pos;
          while (pos < str.length && str[pos] !== '<') pos++;
          var text = str.substring(textStart, pos).trim();
          if (text) children.push({ tag: '#text', text: text, attrs: {}, children: [] });
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
      try { context = JSON.parse(root.attrs['mp-ctx'].replace(/&apos;/g, "'")); }
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
        def.init = extractActions(child);
      } else if (child.tag === 'onexit') {
        def.exit = extractActions(child);
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
  // Two modes, same as HTML mp-to:
  //   target="stateName"         — bare state name, simple transition
  //   mp-to="(s-expression)"     — unified s-expression with guards, actions, emits
  //
  // Transitions use target (bare) or mp-to (s-expression). One rule everywhere.

  function parseTransition(node) {
    var event = node.attrs.event || null;
    var target = node.attrs.target || null;
    var mpTo = node.attrs['mp-to'] || null;

    var def = {};

    if (mpTo) {
      // S-expression mode: decompose into canonical { target, guard, action, emit }
      var slots = engine.decomposeMpTo(mpTo);
      if (slots.target) def.target = slots.target;
      if (slots.guard) def.guard = slots.guard;
      if (slots.action) def.action = slots.action;
      if (slots.emit) def.emit = slots.emit;
    } else if (node.attrs.cond && target) {
      // W3C SCXML cond: guard + bare target
      def.target = target;
      def.guard = node.attrs.cond;
    } else {
      // Bare target mode: simple transition
      def.target = target;
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
      if (child.tag === 'script' || child.tag === 'action') {
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
