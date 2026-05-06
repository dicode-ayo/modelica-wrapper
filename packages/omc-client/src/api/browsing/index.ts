/**
 * Barrel re-exports for the Browsing category.
 *
 * Functions: getVersion, getClassNames, searchClassNames, getClassInformation,
 * isPackage, getInheritanceCount, getInheritedClasses, getUses, existClass.
 *
 * Plus getErrorString — declared here because OMC documents it under Scripting
 * and OmcClient uses it from this module for failed-mutation diagnostics.
 */

export * from "./getVersion.js";
export * from "./getClassNames.js";
export * from "./searchClassNames.js";
export * from "./getClassInformation.js";
export * from "./isPackage.js";
export * from "./getInheritanceCount.js";
export * from "./getInheritedClasses.js";
export * from "./getUses.js";
export * from "./existClass.js";
export * from "./getErrorString.js";
