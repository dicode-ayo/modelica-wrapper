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
- newModel only registers it in OMC's symbol table. It has no file until
  setSourceFile names one and save writes it, and nothing adds it to the
  package's package.order.

Building a model — two ways, pick by what the user needs to see:
- setSourceCode writes a whole class at once, and is far fewer calls.
- addComponent / addConnection / setElementModifierValue edit an existing one
  incrementally, so each step lands in the open diagram as it happens.

Reading results:
- readSimulationResult returns whole series in one call; val samples one
  variable at one time. Prefer readSimulationResult for anything but a spot
  check.

Arguments are this API's names, not the ones in the OMC scripting docs: it is
typeName rather than cl, fileName rather than filename, save rather than
saveModel. omc_describe_function gives the exact shape for anything, and
omc_list_functions finds what is not published as its own tool.

Editing a class from an installed library is refused, with the reason.`;
