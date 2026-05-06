// Package annotations parses Modelica graphical annotations.
//
// OMC returns nested Modelica syntax (not JSON) from getIconAnnotation,
// getDiagramAnnotation, getComponentAnnotations, etc. This package parses
// those into typed shapes (Line, Rectangle, Ellipse, Polygon, Text, Bitmap)
// and Placement transformations per Modelica spec §18.
package annotations
