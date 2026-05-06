// Package fmu loads and steps individual FMUs per the FMI standard.
//
// Each FMU is a zip containing a platform-specific shared library; this
// package dlopens the binary at runtime and runs the stepping loop.
package fmu
