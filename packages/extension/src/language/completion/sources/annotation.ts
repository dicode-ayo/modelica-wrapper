import {
  annotationFields,
  annotationFieldValues,
} from "../../annotation-schema.js";
import {
  CompletionCandidateKind,
  type CompletionCandidate,
} from "../candidate.js";

/**
 * Annotation-position result: the static schema's field names for the record at
 * `path` (empty for an unknown record), as Field candidates. The set is fixed
 * (no prefix-dependent OMC net), so the caller wraps it with `stable`.
 */
export function annotationCandidates(
  path: readonly string[],
): CompletionCandidate[] {
  return annotationFields(path).map((name) => ({
    label: name,
    kind: CompletionCandidateKind.Field,
  }));
}

/**
 * Annotation value-position result: the field's static enum members
 * (`FillPattern.Solid`, …) or boolean literals as candidates, empty for a field
 * with no value vocabulary. A dotted enum label carries a `filterText` of its
 * member segment — VSCode's default word-based filter stops at the dot, so a
 * bare `So` would never match `FillPattern.Solid` otherwise. The full dotted
 * label is the inserted text (a bare member would be an unresolvable reference).
 * The set is fixed, so the caller wraps it with `stable`.
 */
export function annotationValueCandidates(
  field: string,
): CompletionCandidate[] {
  return annotationFieldValues(field).map((value) => {
    const dot = value.lastIndexOf(".");
    if (dot === -1) {
      return { label: value, kind: CompletionCandidateKind.Keyword };
    }
    return {
      label: value,
      kind: CompletionCandidateKind.Property,
      filterText: value.slice(dot + 1),
    };
  });
}
