# VSCode Extension Development Checklist

Use this checklist to ensure you follow best practices when developing VSCode extensions.

## Phase 1: Planning & Setup

### Requirements
- [ ] Extension purpose clearly defined
- [ ] Target user persona identified
- [ ] Key features documented
- [ ] Extension type chosen (command, language, webview, tree view, debugger, theme, snippet)
- [ ] Activation events identified (when should it activate?)
- [ ] UI requirements defined (commands, views, status bar, etc.)

### Project Setup
- [ ] Project scaffolded using `yo code` or template
- [ ] TypeScript configured with strict mode
- [ ] Git repository initialized
- [ ] .gitignore configured
- [ ] ESLint configured
- [ ] README.md created with description and usage
- [ ] CHANGELOG.md created
- [ ] LICENSE file added

## Phase 2: Configuration

### package.json
- [ ] `name` is lowercase with hyphens
- [ ] `displayName` is user-friendly
- [ ] `description` is clear and concise
- [ ] `version` follows semver (0.0.1 for initial)
- [ ] `publisher` is set (registered on marketplace)
- [ ] `engines.vscode` specifies minimum version
- [ ] `categories` is appropriate
- [ ] `keywords` added for discoverability
- [ ] `repository` URL added
- [ ] `icon` path set (128x128 PNG)
- [ ] `activationEvents` configured properly (or empty for auto-inference)
- [ ] `main` points to correct entry file
- [ ] All `contributes` sections properly defined

### Activation Events (Critical!)
- [ ] NOT using `"*"` activation (unless absolutely necessary)
- [ ] Using specific events: `onLanguage`, `onCommand`, `workspaceContains`, etc.
- [ ] OR leaving empty for VS Code 1.74+ auto-inference
- [ ] Lazy loading heavy dependencies

## Phase 3: Implementation

### Code Quality
- [ ] TypeScript strict mode enabled
- [ ] No `any` types without good reason
- [ ] All functions have clear purpose
- [ ] Error handling implemented
- [ ] Async operations used for I/O
- [ ] Resources properly disposed via `context.subscriptions`

### Commands
- [ ] Command IDs follow convention: `extension.commandName`
- [ ] Command titles are descriptive: "Extension Name: Action"
- [ ] Commands registered in both code and package.json
- [ ] All disposables added to `context.subscriptions`

### UI/UX
- [ ] User feedback provided for long operations (progress notifications)
- [ ] Error messages are clear and actionable
- [ ] Success messages when appropriate
- [ ] Icons use Codicons: `$(icon-name)`
- [ ] Follow VS Code naming conventions
- [ ] Keyboard shortcuts don't override common ones

### Configuration
- [ ] Settings have sensible defaults
- [ ] Setting names follow convention: `extensionName.settingName`
- [ ] Settings documented in package.json with descriptions
- [ ] Configuration changes handled via `onDidChangeConfiguration`

### Performance
- [ ] Heavy dependencies lazy loaded (dynamic imports)
- [ ] Document change events debounced
- [ ] File watchers disposed properly
- [ ] No synchronous I/O operations
- [ ] Large files handled in chunks
- [ ] Webviews use `retainContextWhenHidden` sparingly

## Phase 4: Testing

### Unit Tests
- [ ] Test suite created in `src/test/`
- [ ] Extension activation tested
- [ ] Command registration tested
- [ ] Core functionality tested
- [ ] Edge cases covered
- [ ] Mock VSCode API for true unit tests (if needed)

### Integration Tests
- [ ] Test with actual VS Code instance
- [ ] Test in Extension Development Host (F5)
- [ ] Test with different file types
- [ ] Test configuration changes
- [ ] Test with other extensions disabled

### Manual Testing
- [ ] Tested on clean VS Code install
- [ ] Tested with relevant file types
- [ ] Tested all commands
- [ ] Tested all configuration options
- [ ] Tested error scenarios
- [ ] Tested on different OS (if applicable)

## Phase 5: Performance Optimization

### Bundling
- [ ] esbuild configured
- [ ] `vscode:prepublish` script runs bundler
- [ ] External modules properly marked (vscode)
- [ ] Production build minified
- [ ] Source maps disabled in production
- [ ] Bundle size checked (should be <1MB ideally)

### .vscodeignore
- [ ] `src/**` excluded
- [ ] `**/*.ts` excluded
- [ ] `**/*.map` excluded
- [ ] `node_modules/**` excluded (except required runtime deps)
- [ ] `.vscode/**` excluded
- [ ] Test files excluded
- [ ] Development files excluded

### Performance Testing
- [ ] Activation time checked (Developer: Show Running Extensions)
- [ ] Startup impact minimal (Developer: Startup Performance)
- [ ] No blocking operations on main thread
- [ ] Memory usage reasonable
- [ ] CPU usage acceptable

## Phase 6: Documentation

### README.md
- [ ] Extension description and purpose
- [ ] Features list
- [ ] Installation instructions
- [ ] Usage examples with screenshots/GIFs
- [ ] Configuration options documented
- [ ] Known issues listed
- [ ] Links to documentation/repository

### CHANGELOG.md
- [ ] Version history with dates
- [ ] Changes categorized (Added, Changed, Fixed, Removed)
- [ ] Follows Keep a Changelog format
- [ ] Breaking changes highlighted

### Code Documentation
- [ ] Complex functions commented
- [ ] Public API documented
- [ ] Example usage provided where helpful
- [ ] No excessive commenting (code should be self-documenting)

## Phase 7: Pre-Publication

### Package Testing
- [ ] Package created: `vsce package`
- [ ] VSIX file tested locally: `code --install-extension *.vsix`
- [ ] Tested in clean VS Code profile
- [ ] Extension size checked (ideally <2MB)
- [ ] All functionality works from VSIX

### Marketplace Preparation
- [ ] Publisher account created
- [ ] Personal Access Token (PAT) generated
- [ ] Icon is 128x128 PNG
- [ ] Categories appropriate
- [ ] Keywords optimize discoverability
- [ ] Repository URL public and accessible
- [ ] License specified

### Final Checks
- [ ] No console.log statements in production code
- [ ] No hardcoded paths or credentials
- [ ] All TODOs addressed
- [ ] Version number incremented
- [ ] Git committed and tagged
- [ ] CI/CD pipeline configured (if applicable)

## Phase 8: Publishing

### Marketplace
- [ ] Published: `vsce publish`
- [ ] Extension visible on marketplace
- [ ] All metadata displays correctly
- [ ] Screenshots/GIFs render properly
- [ ] Installation works from marketplace
- [ ] Extension appears in search results

### Post-Publication
- [ ] Monitor marketplace reviews
- [ ] Set up issue tracker (GitHub Issues)
- [ ] Monitor download statistics
- [ ] Respond to user feedback
- [ ] Plan for updates and maintenance

## Ongoing Maintenance

### Regular Updates
- [ ] Keep dependencies updated
- [ ] Follow VS Code API changes
- [ ] Update for new VS Code versions
- [ ] Fix reported bugs promptly
- [ ] Add requested features when appropriate

### Community
- [ ] Respond to issues on GitHub
- [ ] Review pull requests
- [ ] Update documentation based on feedback
- [ ] Deprecate features properly with warnings
- [ ] Announce major changes

## Performance Benchmarks

### Target Metrics
- [ ] Activation time: <1 second (preferably <500ms)
- [ ] Package size: <2MB (preferably <1MB)
- [ ] Memory usage: <50MB baseline
- [ ] CPU usage: Minimal when idle

### Red Flags
- [ ] ❌ Activation time >2 seconds
- [ ] ❌ Package size >5MB
- [ ] ❌ Constant CPU usage >5% when idle
- [ ] ❌ Memory leaks (increasing over time)
- [ ] ❌ Blocking UI thread

## Security Checklist

### Code Security
- [ ] No hardcoded credentials
- [ ] Sensitive data not logged
- [ ] User input validated and sanitized
- [ ] File paths validated (no path traversal)
- [ ] Webview CSP configured properly
- [ ] External resources use HTTPS

### Dependency Security
- [ ] Dependencies audited: `npm audit`
- [ ] No known vulnerabilities
- [ ] Minimal dependencies used
- [ ] Dependencies regularly updated

## Accessibility

- [ ] Keyboard navigation works
- [ ] Screen reader compatible
- [ ] High contrast themes supported
- [ ] Text readable at different zoom levels
- [ ] Focus indicators visible

## Common Pitfalls to Avoid

❌ **Using `activationEvents: ["*"]`**
- Slows down VS Code startup significantly

❌ **Not bundling for production**
- Results in slow activation and large package size

❌ **Synchronous file operations**
- Blocks UI thread, causing freezes

❌ **Not debouncing document changes**
- Causes excessive CPU usage

❌ **Memory leaks from undisposed resources**
- Extension uses more memory over time

❌ **Not testing in clean VS Code instance**
- May work with your extensions but not for users

❌ **Overriding common keyboard shortcuts**
- Frustrates users

❌ **Poor error messages**
- Users don't know what went wrong or how to fix it

❌ **Not following VS Code conventions**
- Extension feels out of place

## Quick Command Reference

```bash
# Create new extension
npx --package yo --package generator-code -- yo code

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode
npm run watch

# Run tests
npm test

# Package extension
npx @vscode/vsce package

# Install locally
code --install-extension extension-0.0.1.vsix

# Publish to marketplace
npx @vscode/vsce publish

# Check activation time
# F1 > Developer: Show Running Extensions

# Profile startup
# F1 > Developer: Startup Performance

# Debug extension
# Press F5 in VS Code
```

## Support Resources

- Official Docs: https://code.visualstudio.com/api
- Extension Samples: https://github.com/microsoft/vscode-extension-samples
- VS Code API: https://code.visualstudio.com/api/references/vscode-api
- Stack Overflow: [vscode-extensions] tag
- VS Code GitHub: https://github.com/microsoft/vscode

---

Print this checklist and check off items as you complete them!
