/**
 * machine_native — SCXML transforms.
 *
 * Utilities for reading and mutating SCXML machine strings.
 * SCXML is the only wire format between nodes. Each node handles
 * its own substrate internally (browser uses XSLT → HTML,
 * server executes effects and returns SCXML).
 *
 * @version 0.8.0
 * @license MIT
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.MPTransforms = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  XML attribute escaping                                                 ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // Only < and & MUST be escaped in XML attributes. > is legal inside
  // attribute values and must NOT be escaped — s-expressions like
  // (> amount 0) depend on it passing through literally.

  function esc(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  // Unescape XML entities. Identical to _unescXml in scxml.js — kept separate
  // to avoid adding a dependency. &amp; must be last to prevent double-unescape.
  function unescapeEntities(str) {
    return str.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Context extraction — read machine metadata from SCXML                  ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // Reads context, name, and current state from an SCXML machine string.
  // The mn-ctx attribute carries JSON context on the <scxml> root element.

  function extractContext(scxml) {
    if (!scxml || typeof scxml !== 'string') return {};
    var match = scxml.match(/mn-ctx='([^']*)'/) || scxml.match(/mn-ctx="([^"]*)"/);
    if (!match) return {};
    try { return JSON.parse(unescapeEntities(match[1])); }
    catch (e) { return {}; }
  }

  function extractMachine(scxml) {
    if (!scxml || typeof scxml !== 'string') return { name: null, state: null, context: null };
    // Match id, name, and initial on the <scxml> root element only
    var rootMatch = scxml.match(/<scxml\b([^>]*)>/);
    var rootAttrs = rootMatch ? rootMatch[1] : '';
    var idMatch = rootAttrs.match(/\bid="([^"]+)"/);
    var nameMatch = rootAttrs.match(/\bname="([^"]+)"/);
    var initialMatch = rootAttrs.match(/\binitial="([^"]+)"/);
    return {
      name: nameMatch ? nameMatch[1] : (idMatch ? idMatch[1] : null),
      state: initialMatch ? initialMatch[1] : null,
      context: extractContext(scxml)
    };
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  SCXML state mutation                                                   ║
  // ╚══════════════════════════════════════════════════════════════════════════╝
  //
  // Mutate state and context IN PLACE on an SCXML string.
  // No full parse and rewrite. Just update the attributes.
  // Used by executePipeline as the formatUpdater callback.

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
      var ctxJson = JSON.stringify(newContext).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&apos;');
      if (updated.indexOf("mn-ctx='") !== -1) {
        updated = updated.replace(/mn-ctx='[^']*'/, function () { return "mn-ctx='" + ctxJson + "'"; });
      } else {
        updated = updated.replace(/(<scxml\b[^>]*?)(\s*\/?>)/, function (m, p1, p2) {
          return p1 + " mn-ctx='" + ctxJson + "'" + p2;
        });
      }
    }

    return updated;
  }


  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Public API                                                             ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  // ╔══════════════════════════════════════════════════════════════════════════╗
  // ║  Transport metadata                                                     ║
  // ╚══════════════════════════════════════════════════════════════════════════╝

  function extractMetadata(scxml, attr) {
    var rootMatch = scxml.match(/<scxml\b([^>]*)>/);
    var rootAttrs = rootMatch ? rootMatch[1] : '';
    var re = new RegExp('\\b' + attr + '="([^"]*)"');
    var match = rootAttrs.match(re);
    return match ? match[1] : null;
  }

  function stampMetadata(scxml, attrs) {
    var parts = [];
    for (var key in attrs) {
      if (attrs.hasOwnProperty(key)) parts.push(key + '="' + esc(String(attrs[key])) + '"');
    }
    if (parts.length === 0) return scxml;
    return scxml.replace(/<scxml\b/, '<scxml ' + parts.join(' '));
  }


  return {
    extractContext: extractContext,
    extractMachine: extractMachine,
    updateScxmlState: updateScxmlState,
    extractMetadata: extractMetadata,
    stampMetadata: stampMetadata,
    esc: esc,
    version: '0.8.0'
  };
});
