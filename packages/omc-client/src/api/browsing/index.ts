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
export * from "./getMessagesStringInternal.js";
export * from "./existModel.js";
export * from "./existPackage.js";
export * from "./getClassRestriction.js";
export * from "./isType.js";
export * from "./isClass.js";
export * from "./isRecord.js";
export * from "./isBlock.js";
export * from "./isFunction.js";
export * from "./isModel.js";
export * from "./isConnector.js";
export * from "./isPartial.js";
export * from "./isReplaceable.js";
export * from "./isProtectedClass.js";
export * from "./isEnumeration.js";
export * from "./isConstant.js";
export * from "./isParameter.js";
export * from "./isProtected.js";
export * from "./isRedeclare.js";
export * from "./isPrimitive.js";
export * from "./isOperator.js";
export * from "./isOperatorFunction.js";
export * from "./isOperatorRecord.js";
export * from "./isOptimization.js";
export * from "./getClassComment.js";
export * from "./getEnumerationLiterals.js";
export * from "./getReplaceableChoices.js";
export * from "./extendsFrom.js";
export * from "./getAllSubtypeOf.js";
export * from "./classAnnotationExists.js";
export * from "./getNthInheritedClass.js";
export * from "./isShortDefinition.js";
