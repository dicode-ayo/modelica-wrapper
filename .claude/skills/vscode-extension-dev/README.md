# VSCode Extension Development Skill

A comprehensive skill for developing Visual Studio Code extensions with modern best practices, performance optimization, and complete API coverage.

## What This Skill Provides

This skill makes me an expert in VSCode extension development, with deep knowledge of:

- **Extension Architecture**: All extension types (commands, language support, webviews, tree views, debuggers, themes, snippets)
- **Performance Optimization**: Lazy loading, efficient activation events, bundling with esbuild, debouncing
- **Modern Tooling**: TypeScript, @vscode/test-cli, modern VS Code APIs (2026)
- **Testing & Debugging**: Integration tests, unit tests, debugging patterns
- **UX Best Practices**: Following VS Code conventions and patterns
- **Complete API Coverage**: commands, window, workspace, languages, and more

## When to Use This Skill

Use this skill when working on:
- Creating new VSCode extensions from scratch
- Debugging or improving existing extensions
- Optimizing extension performance
- Implementing specific VSCode API features
- Testing VSCode extensions
- Publishing extensions to the marketplace

## Key Features

### 1. Structured Development Workflow
- Requirements gathering and architecture selection
- Project setup with modern tooling
- Implementation with best practices
- Testing and debugging
- Publishing to marketplace

### 2. Performance-First Approach
- Specific activation events (never use `*`)
- Lazy loading of dependencies
- Bundling for production (50%+ faster activation)
- Event debouncing patterns
- Resource management best practices

### 3. Comprehensive Patterns Library
Ready-to-use code patterns for:
- Commands (simple, text editor, with input)
- UI components (status bar, progress, quick pick)
- File operations (read, write, watch)
- Configuration management
- Document listeners
- Language features (hover, completion, diagnostics, code actions)
- Webviews with communication
- Tree views
- Testing

### 4. Modern Stack (2026)
- TypeScript with strict mode
- esbuild for fast bundling
- @vscode/test-cli for testing
- Auto-inferred activation events (VS Code 1.74+)
- Latest VS Code API patterns

## Files in This Skill

### SKILL.md
The main skill definition with:
- Complete development workflow (7 phases)
- Architecture patterns for all extension types
- Performance best practices
- VSCode API namespace reference
- Common contribution points
- UX guidelines
- Testing and debugging strategies
- Troubleshooting guide

### templates.md
Copy-paste ready templates for:
- Basic extension structure
- All common patterns
- Language providers
- Webviews
- Tree views
- Testing
- Bundling configuration

### README.md (this file)
Overview and quick reference

## Quick Start Examples

### Create New Extension
```bash
npx --package yo --package generator-code -- yo code
```

### Basic Command Extension
```typescript
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('extension.hello', () => {
    vscode.window.showInformationMessage('Hello World!');
  });
  context.subscriptions.push(disposable);
}

export function deactivate() {}
```

### Performance-Optimized package.json
```json
{
  "activationEvents": [],  // Auto-inferred!
  "contributes": {
    "commands": [{
      "command": "extension.hello",
      "title": "Hello World"
    }]
  }
}
```

## Best Practices Summary

### ✓ DO:
- Use TypeScript with strict mode
- Implement specific activation events (or leave empty for auto-inference)
- Bundle your extension for production with esbuild
- Debounce expensive operations
- Dispose resources properly via context.subscriptions
- Provide user feedback for long operations
- Follow VS Code UX guidelines
- Write comprehensive tests

### ✗ DON'T:
- Use `activationEvents: ["*"]` (slow startup!)
- Block the UI thread with synchronous operations
- Load heavy dependencies at startup
- Ignore errors silently
- Override common keyboard shortcuts
- Publish without bundling
- Skip testing

## Performance Optimization Impact

Real-world examples from VS Code docs:
- **Azure Account Extension**: Bundling reduced activation from ~6s to ~3s (50% faster), size from 6.2MB to 840KB
- **Docker Extension**: Activation reduced from 3.5s to 2s, cold activation from 20s to 2s

## Common API Patterns

```typescript
// Commands
vscode.commands.registerCommand(id, callback)

// UI
vscode.window.showInformationMessage(message)
vscode.window.showQuickPick(items)
vscode.window.showInputBox(options)

// Configuration
vscode.workspace.getConfiguration('section')

// File System
vscode.workspace.fs.readFile(uri)
vscode.workspace.fs.writeFile(uri, data)

// Diagnostics
vscode.languages.createDiagnosticCollection(name)

// Language Features
vscode.languages.registerHoverProvider(selector, provider)
vscode.languages.registerCompletionItemProvider(selector, provider)
```

## Resources

- [VSCode Extension API](https://code.visualstudio.com/api)
- [Extension Samples](https://github.com/microsoft/vscode-extension-samples)
- [Extension Manifest](https://code.visualstudio.com/api/references/extension-manifest)
- [Contribution Points](https://code.visualstudio.com/api/references/contribution-points)
- [VSCode API Reference](https://code.visualstudio.com/api/references/vscode-api)
- [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)

## Sources & Research

This skill was created based on comprehensive research of:
- Official VSCode Extension API documentation (2026)
- Modern development best practices from the community
- Performance optimization techniques
- Real-world extension examples
- VSCode team recommendations

Research sources:
- [Building VS Code Extensions in 2026: The Complete Guide](https://abdulkadersafi.com/blog/building-vs-code-extensions-in-2026-the-complete-modern-guide)
- [Extension API Documentation](https://code.visualstudio.com/api)
- [VS Code Performance Optimization](https://www.freecodecamp.org/news/optimize-vscode-performance-best-extensions/)
- [Testing Extensions](https://code.visualstudio.com/api/working-with-extensions/testing-extension)
- [Extension Manifest](https://code.visualstudio.com/api/references/extension-manifest)
- [Contribution Points](https://code.visualstudio.com/api/references/contribution-points)

## How to Use This Skill

Simply reference it when asking questions about VSCode extension development:

- "Help me create a VSCode extension for..."
- "How do I implement hover tooltips in VSCode?"
- "Optimize my extension's performance"
- "Set up testing for my VSCode extension"
- "Create a webview panel in my extension"

The skill will automatically guide development following best practices and modern patterns.

---

Created: 2026-02-02
Version: 1.0
Maintained by: Claude Code
