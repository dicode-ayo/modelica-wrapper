import type { ResolveClient } from "@dicode/modelica-lang-core";

/**
 * OMC surface the completion sources need: the resolution calls (via
 * {@link ResolveClient}, reused for the member-access head walk) plus the four
 * typed candidate-source wrappers. `OmcClient` satisfies this, so real call
 * sites pass it unchanged.
 */
export interface CompletionClient extends ResolveClient {
  getClassNames(input: {
    typeName?: string;
    qualified?: boolean;
  }): Promise<{ classNames: string[] }>;
  searchClassNames(input: {
    searchText: string;
  }): Promise<{ classNames: string[] }>;
  getParameterNames(input: { typeName: string }): Promise<{
    parameters: string[];
  }>;
  isPackage(input: { typeName: string }): Promise<{ b: boolean }>;
}
