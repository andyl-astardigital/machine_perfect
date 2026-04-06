# ADR-007: SCXML as backend markup substrate

## Status
Accepted

## Context
The backend needs a markup format for defining machines. Options: custom XML, custom JSON, YAML, or SCXML (W3C standard).

## Decision
Use SCXML (State Chart XML, W3C) as the structural format for backend machine definitions, extended with `mp-` attributes for s-expression guards, actions, and capability routing.

## Rationale
- **W3C standard** — established semantics for states, transitions, events, datamodels, parallel states, history states, final states. We don't need to invent these.
- **XML is transformable** — XSLT can inject audit logging, strip internal states, compose machines. This is a future capability but the format choice enables it.
- **XML is validatable** — XSD can check structural correctness of machine definitions. Future capability.
- **Familiar to enterprise** — SCXML is known in BPM, workflow, and embedded systems. The format is not an adoption barrier for backend teams.
- **MP extensions are namespaced** — `mp-to`, `mp-effect` sit cleanly alongside standard SCXML attributes. Guards, actions, and emits are unified inside `mp-to` s-expressions. We extend without conflicting.

## Example

```xml
<scxml xmlns="http://www.w3.org/2005/07/scxml"
       
       initial="draft">
  <datamodel>
    <data id="items" expr="[]"/>
  </datamodel>
  <state id="draft">
    <transition event="submit"
                mp-to="(when (> (count items) 0) (do (set! submitted_at (now)) (to submitted)))"/>
  </state>
  <state id="submitted">
    <transition event="approve" target="approved"/>
  </state>
  <final id="approved"/>
</scxml>
```

## Consequences
- Requires an XML parser in Node. `fast-xml-parser` or `saxes` are lightweight options.
- Only a subset of SCXML is supported initially (simple states, transitions, datamodel, final). Parallel states, history states, and invoke are deferred.
- The `cond` attribute in standard SCXML expects ECMAScript. We use `mp-to` with s-expression guards via `(when ...)` instead, which is a divergence from the spec.
- The backend compiler's job is: SCXML + MP → canonical machine definition. The canonical format is the same one the browser produces from HTML.
