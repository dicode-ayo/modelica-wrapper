import {
  resolveEnableConstants,
  type EnableConstantClient,
  type ParameterModel,
} from "@dicode/omc-client";

import {
  resolveGroupImages,
  type UriResolveClient,
} from "../documentation/documentation-resources.js";

/**
 * The host-side passes a `ParameterModel` needs before it reaches the
 * webview, which has no OMC: group images inlined as `data:` URIs, and the
 * library constants its `Dialog.enable` expressions reference resolved.
 */
export async function prepareParameterModel(
  client: UriResolveClient & EnableConstantClient,
  model: ParameterModel,
): Promise<ParameterModel> {
  return resolveEnableConstants(
    client,
    await resolveGroupImages(client, model),
  );
}
