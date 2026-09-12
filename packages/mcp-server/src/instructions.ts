/**
 * What the server tells a client about itself, before any tool is called.
 *
 * Every line here was paid for once by a caller who had to discover it: which
 * calls persist and which do not, which of two ways to build a model fits the
 * job, and that argument names are this API's rather than the OMC scripting
 * documentation's. A tool description reaches a model only once it is reading
 * that tool; this reaches it while it is still deciding what to do.
 */
export const SERVER_INSTRUCTIONS = `OpenModelica scripting, driving the same OMC process as the editor — a class
you load or edit here is the one the user sees in their diagram and sidebar.

Creating a class:
- createClass declares it, writes it to disk and adds it to the enclosing
  package's package.order. newModel, reachable through omc_invoke, does only
  the first of those, so a class made with it is gone at the next restart.

Saving:
- createClass is the only call that writes a file on its own. Every edit after
  it lives in OMC's memory until saveClass runs, so a model built and simulated
  entirely through these tools is still whatever was last written to disk.
  Call saveClass on the class you edited once you are done editing it; on a
  package it saves the members too.

Building a model — two ways, pick by what the user needs to see:
- setSourceCode writes a whole class at once, and is far fewer calls.
- addComponent / addConnection / setElementModifierValue edit an existing one
  incrementally, so each step lands in the open diagram as it happens.

Reading results:
- readSimulationResult returns whole series in one call; val samples one
  variable at one time. Prefer readSimulationResult for anything but a spot
  check.

Arguments are this API's names, not the ones in the OMC scripting docs: it is
typeName rather than cl, fileName rather than filename. omc_describe_function
gives the exact shape for anything, and omc_list_functions finds what is not
published as its own tool.

Class names, component references and modifier paths reach OMC unquoted, so
they are held to the Modelica name grammar: dotted identifiers, optionally
subscripted, or a single-quoted Q-IDENT. Annotations and modifier values are
expressions, held to being self-contained — balanced brackets, no separator
outside a string. Anything else is refused rather than escaped, because it
would otherwise run as part of the command. A refusal here names the field and
means the value was malformed, not that the operation was forbidden.

Editing a class from an installed library is refused, with the reason.`;
