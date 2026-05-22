# VSCode Extension Templates & Snippets

Quick copy-paste templates for common VSCode extension patterns.

## Basic Extension Structure

### Minimal package.json
```json
{
  "name": "my-extension",
  "displayName": "My Extension",
  "description": "Extension description",
  "version": "0.0.1",
  "publisher": "your-publisher-id",
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": ["Other"],
  "activationEvents": [],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "myExtension.helloWorld",
        "title": "Hello World"
      }
    ]
  },
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./",
    "pretest": "npm run compile && npm run lint",
    "lint": "eslint src --ext ts",
    "test": "vscode-test"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "@types/node": "20.x",
    "@typescript-eslint/eslint-plugin": "^6.13.0",
    "@typescript-eslint/parser": "^6.13.0",
    "eslint": "^8.54.0",
    "typescript": "^5.3.0",
    "@vscode/test-cli": "^0.0.4",
    "@vscode/test-electron": "^2.3.8"
  }
}
```

### Basic extension.ts
```typescript
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  console.log('Extension activated');

  const disposable = vscode.commands.registerCommand('myExtension.helloWorld', () => {
    vscode.window.showInformationMessage('Hello World!');
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}
```

### TypeScript Configuration (tsconfig.json)
```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2020",
    "outDir": "out",
    "lib": ["ES2020"],
    "sourceMap": true,
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "exclude": ["node_modules", ".vscode-test"]
}
```

## Command Patterns

### Simple Command with Input
```typescript
const disposable = vscode.commands.registerCommand('extension.greet', async () => {
  const name = await vscode.window.showInputBox({
    prompt: 'Enter your name',
    placeHolder: 'John Doe',
    validateInput: (text) => {
      return text.length < 2 ? 'Name must be at least 2 characters' : null;
    }
  });

  if (name) {
    vscode.window.showInformationMessage(`Hello, ${name}!`);
  }
});

context.subscriptions.push(disposable);
```

### Quick Pick Selection
```typescript
const disposable = vscode.commands.registerCommand('extension.selectOption', async () => {
  interface QuickPickItem extends vscode.QuickPickItem {
    action: () => void;
  }

  const items: QuickPickItem[] = [
    {
      label: '$(file) Option 1',
      description: 'First option',
      detail: 'Details about option 1',
      action: () => console.log('Option 1 selected')
    },
    {
      label: '$(folder) Option 2',
      description: 'Second option',
      detail: 'Details about option 2',
      action: () => console.log('Option 2 selected')
    }
  ];

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select an option',
    matchOnDescription: true,
    matchOnDetail: true
  });

  if (selected) {
    selected.action();
  }
});
```

### Text Editor Command
```typescript
const disposable = vscode.commands.registerTextEditorCommand(
  'extension.insertText',
  (editor, edit, ...args) => {
    const position = editor.selection.active;
    edit.insert(position, 'Inserted text');
  }
);
```

## UI Components

### Status Bar Item with Command
```typescript
function createStatusBar(context: vscode.ExtensionContext) {
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );

  statusBar.text = '$(check) Ready';
  statusBar.tooltip = 'Click to run command';
  statusBar.command = 'extension.statusBarCommand';
  statusBar.backgroundColor = undefined; // Or new vscode.ThemeColor('statusBarItem.errorBackground')
  statusBar.show();

  context.subscriptions.push(statusBar);

  // Update status bar
  function updateStatusBar(text: string, color?: string) {
    statusBar.text = text;
    statusBar.color = color;
  }

  return { statusBar, updateStatusBar };
}
```

### Output Channel
```typescript
function createOutputChannel(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('My Extension');
  context.subscriptions.push(outputChannel);

  outputChannel.appendLine('Extension started');
  outputChannel.show(); // Show the channel

  return outputChannel;
}
```

### Progress Notification
```typescript
async function showProgress() {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Processing files',
      cancellable: true
    },
    async (progress, token) => {
      token.onCancellationRequested(() => {
        console.log('User canceled operation');
      });

      progress.report({ increment: 0, message: 'Starting...' });

      for (let i = 0; i < 10; i++) {
        if (token.isCancellationRequested) {
          break;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
        progress.report({
          increment: 10,
          message: `Processing item ${i + 1}/10`
        });
      }

      progress.report({ increment: 100, message: 'Complete!' });
    }
  );
}
```

## File Operations

### Read Active File
```typescript
async function readActiveFile() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('No active editor');
    return;
  }

  const document = editor.document;
  const content = document.getText();
  const fileName = document.fileName;
  const languageId = document.languageId;

  console.log(`File: ${fileName}, Language: ${languageId}`);
  return content;
}
```

### Write to File (VS Code FS API)
```typescript
async function writeFile(uri: vscode.Uri, content: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);

  try {
    await vscode.workspace.fs.writeFile(uri, data);
    vscode.window.showInformationMessage('File saved successfully');
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to save file: ${error}`);
  }
}
```

### Read File (VS Code FS API)
```typescript
async function readFile(uri: vscode.Uri): Promise<string> {
  try {
    const data = await vscode.workspace.fs.readFile(uri);
    const decoder = new TextDecoder();
    return decoder.decode(data);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to read file: ${error}`);
    throw error;
  }
}
```

### File Picker
```typescript
async function pickFile() {
  const result = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: {
      'Text files': ['txt', 'md'],
      'All files': ['*']
    },
    title: 'Select a file'
  });

  if (result && result[0]) {
    const uri = result[0];
    const content = await readFile(uri);
    return { uri, content };
  }
}
```

### File Watcher
```typescript
function watchFiles(context: vscode.ExtensionContext) {
  const watcher = vscode.workspace.createFileSystemWatcher(
    '**/*.{js,ts}', // Pattern
    false, // ignoreCreateEvents
    false, // ignoreChangeEvents
    false  // ignoreDeleteEvents
  );

  watcher.onDidCreate(uri => {
    console.log(`File created: ${uri.fsPath}`);
  });

  watcher.onDidChange(uri => {
    console.log(`File changed: ${uri.fsPath}`);
  });

  watcher.onDidDelete(uri => {
    console.log(`File deleted: ${uri.fsPath}`);
  });

  context.subscriptions.push(watcher);
}
```

## Configuration

### Define Configuration (package.json)
```json
{
  "contributes": {
    "configuration": {
      "title": "My Extension",
      "properties": {
        "myExtension.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Enable/disable the extension"
        },
        "myExtension.maxItems": {
          "type": "number",
          "default": 100,
          "minimum": 1,
          "maximum": 1000,
          "description": "Maximum number of items"
        },
        "myExtension.outputFormat": {
          "type": "string",
          "enum": ["json", "yaml", "xml"],
          "default": "json",
          "description": "Output format"
        },
        "myExtension.excludePatterns": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "default": ["node_modules", ".git"],
          "description": "Patterns to exclude"
        }
      }
    }
  }
}
```

### Read Configuration
```typescript
function getConfig<T>(key: string, defaultValue: T): T {
  const config = vscode.workspace.getConfiguration('myExtension');
  return config.get<T>(key, defaultValue);
}

// Usage
const isEnabled = getConfig('enabled', true);
const maxItems = getConfig('maxItems', 100);
const format = getConfig('outputFormat', 'json');
```

### Update Configuration
```typescript
async function updateConfig(key: string, value: any, global: boolean = false) {
  const config = vscode.workspace.getConfiguration('myExtension');
  const target = global
    ? vscode.ConfigurationTarget.Global
    : vscode.ConfigurationTarget.Workspace;

  await config.update(key, value, target);
}
```

### Listen to Configuration Changes
```typescript
function watchConfiguration(context: vscode.ExtensionContext) {
  const disposable = vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('myExtension')) {
      console.log('Configuration changed');

      if (e.affectsConfiguration('myExtension.enabled')) {
        const isEnabled = getConfig('enabled', true);
        console.log(`Extension is now ${isEnabled ? 'enabled' : 'disabled'}`);
      }
    }
  });

  context.subscriptions.push(disposable);
}
```

## Document Listeners

### Document Change Listener (with Debounce)
```typescript
function setupDocumentListener(context: vscode.ExtensionContext) {
  let timeout: NodeJS.Timeout | undefined;

  const disposable = vscode.workspace.onDidChangeTextDocument(event => {
    const document = event.document;

    // Only process certain file types
    if (document.languageId !== 'javascript' && document.languageId !== 'typescript') {
      return;
    }

    // Debounce
    if (timeout) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(() => {
      analyzeDocument(document);
    }, 500);
  });

  context.subscriptions.push(disposable);
}

function analyzeDocument(document: vscode.TextDocument) {
  console.log(`Analyzing ${document.fileName}`);
  // Perform analysis
}
```

### Document Save Listener
```typescript
function setupSaveListener(context: vscode.ExtensionContext) {
  const disposable = vscode.workspace.onDidSaveTextDocument(document => {
    vscode.window.showInformationMessage(`Saved: ${document.fileName}`);
    // Perform actions on save
  });

  context.subscriptions.push(disposable);
}
```

### Active Editor Change
```typescript
function setupEditorListener(context: vscode.ExtensionContext) {
  const disposable = vscode.window.onDidChangeActiveTextEditor(editor => {
    if (editor) {
      console.log(`Active editor: ${editor.document.fileName}`);
    } else {
      console.log('No active editor');
    }
  });

  context.subscriptions.push(disposable);
}
```

## Language Features

### Hover Provider
```typescript
function registerHoverProvider(context: vscode.ExtensionContext) {
  const provider = vscode.languages.registerHoverProvider(
    { scheme: 'file', language: 'javascript' },
    {
      provideHover(document, position, token) {
        const range = document.getWordRangeAtPosition(position);
        const word = document.getText(range);

        const markdown = new vscode.MarkdownString();
        markdown.appendMarkdown(`**${word}**\n\n`);
        markdown.appendMarkdown('Hover information here');
        markdown.isTrusted = true;
        markdown.supportHtml = true;

        return new vscode.Hover(markdown);
      }
    }
  );

  context.subscriptions.push(provider);
}
```

### Completion Provider
```typescript
function registerCompletionProvider(context: vscode.ExtensionContext) {
  const provider = vscode.languages.registerCompletionItemProvider(
    'javascript',
    {
      provideCompletionItems(document, position, token, context) {
        const items: vscode.CompletionItem[] = [];

        // Simple completion
        const item1 = new vscode.CompletionItem('myFunction', vscode.CompletionItemKind.Function);
        item1.detail = 'My custom function';
        item1.documentation = new vscode.MarkdownString('Does something cool');
        items.push(item1);

        // Snippet completion
        const item2 = new vscode.CompletionItem('mySnippet', vscode.CompletionItemKind.Snippet);
        item2.insertText = new vscode.SnippetString('function ${1:name}(${2:params}) {\n\t$0\n}');
        item2.documentation = 'Inserts a function template';
        items.push(item2);

        return items;
      }
    },
    '.' // Trigger character
  );

  context.subscriptions.push(provider);
}
```

### Diagnostics
```typescript
function setupDiagnostics(context: vscode.ExtensionContext) {
  const diagnosticCollection = vscode.languages.createDiagnosticCollection('myExtension');
  context.subscriptions.push(diagnosticCollection);

  function updateDiagnostics(document: vscode.TextDocument) {
    if (document.languageId !== 'javascript') {
      return;
    }

    const diagnostics: vscode.Diagnostic[] = [];
    const text = document.getText();

    // Example: Find TODO comments
    const regex = /\/\/\s*TODO:/gi;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const line = document.positionAt(match.index).line;
      const range = new vscode.Range(line, 0, line, match[0].length);

      const diagnostic = new vscode.Diagnostic(
        range,
        'TODO found',
        vscode.DiagnosticSeverity.Information
      );

      diagnostic.code = 'todo-found';
      diagnostic.source = 'myExtension';

      diagnostics.push(diagnostic);
    }

    diagnosticCollection.set(document.uri, diagnostics);
  }

  // Update diagnostics on document change
  vscode.workspace.onDidChangeTextDocument(e => updateDiagnostics(e.document));
  vscode.workspace.onDidOpenTextDocument(doc => updateDiagnostics(doc));

  // Update all open documents
  vscode.workspace.textDocuments.forEach(updateDiagnostics);
}
```

### Code Actions (Quick Fixes)
```typescript
function registerCodeActions(context: vscode.ExtensionContext) {
  const provider = vscode.languages.registerCodeActionsProvider(
    'javascript',
    {
      provideCodeActions(document, range, context, token) {
        const codeActions: vscode.CodeAction[] = [];

        // Check if there's a diagnostic to fix
        for (const diagnostic of context.diagnostics) {
          if (diagnostic.code === 'todo-found') {
            const action = new vscode.CodeAction(
              'Remove TODO',
              vscode.CodeActionKind.QuickFix
            );
            action.diagnostics = [diagnostic];
            action.edit = new vscode.WorkspaceEdit();
            action.edit.delete(document.uri, diagnostic.range);
            codeActions.push(action);
          }
        }

        // Add refactor action
        const refactorAction = new vscode.CodeAction(
          'Extract to function',
          vscode.CodeActionKind.Refactor
        );
        refactorAction.command = {
          command: 'extension.extractFunction',
          title: 'Extract Function',
          arguments: [document, range]
        };
        codeActions.push(refactorAction);

        return codeActions;
      }
    }
  );

  context.subscriptions.push(provider);
}
```

## Webview

### Basic Webview
```typescript
function createWebview(context: vscode.ExtensionContext) {
  const panel = vscode.window.createWebviewPanel(
    'myWebview',
    'My Webview',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, 'media'),
        vscode.Uri.joinPath(context.extensionUri, 'out')
      ],
      retainContextWhenHidden: true // Keep state when hidden
    }
  );

  panel.webview.html = getWebviewContent(panel.webview, context.extensionUri);

  // Handle messages from webview
  panel.webview.onDidReceiveMessage(
    message => {
      switch (message.command) {
        case 'alert':
          vscode.window.showInformationMessage(message.text);
          break;
        case 'getData':
          panel.webview.postMessage({
            command: 'data',
            data: { foo: 'bar' }
          });
          break;
      }
    },
    undefined,
    context.subscriptions
  );

  // Handle disposal
  panel.onDidDispose(
    () => {
      console.log('Webview disposed');
    },
    null,
    context.subscriptions
  );

  return panel;
}

function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'main.js')
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'style.css')
  );

  // Use a nonce for security
  const nonce = getNonce();

  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <link href="${styleUri}" rel="stylesheet">
    <title>My Webview</title>
  </head>
  <body>
    <h1>Hello from Webview!</h1>
    <button id="sendBtn">Send Message</button>
    <div id="output"></div>

    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
  </html>`;
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
```

### Webview Script (media/main.js)
```javascript
(function() {
  const vscode = acquireVsCodeApi();

  // Save state
  const state = vscode.getState() || { count: 0 };

  document.getElementById('sendBtn').addEventListener('click', () => {
    state.count++;
    vscode.setState(state);

    vscode.postMessage({
      command: 'alert',
      text: `Clicked ${state.count} times`
    });
  });

  // Listen for messages from extension
  window.addEventListener('message', event => {
    const message = event.data;
    switch (message.command) {
      case 'data':
        document.getElementById('output').textContent = JSON.stringify(message.data);
        break;
    }
  });
})();
```

## Tree View

### Tree View Provider
```typescript
class MyTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly children?: MyTreeItem[]
  ) {
    super(label, collapsibleState);

    this.tooltip = `${this.label}`;
    this.description = 'Description';

    // Add icon
    this.iconPath = new vscode.ThemeIcon('file');

    // Add context value for menu contributions
    this.contextValue = 'myTreeItem';

    // Make item clickable
    if (!children) {
      this.command = {
        command: 'extension.openItem',
        title: 'Open Item',
        arguments: [this]
      };
    }
  }
}

class MyTreeDataProvider implements vscode.TreeDataProvider<MyTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<MyTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: MyTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: MyTreeItem): Thenable<MyTreeItem[]> {
    if (!element) {
      // Root items
      return Promise.resolve([
        new MyTreeItem('Item 1', vscode.TreeItemCollapsibleState.Collapsed, [
          new MyTreeItem('Child 1', vscode.TreeItemCollapsibleState.None),
          new MyTreeItem('Child 2', vscode.TreeItemCollapsibleState.None)
        ]),
        new MyTreeItem('Item 2', vscode.TreeItemCollapsibleState.None)
      ]);
    } else {
      // Child items
      return Promise.resolve(element.children || []);
    }
  }
}

function registerTreeView(context: vscode.ExtensionContext) {
  const treeDataProvider = new MyTreeDataProvider();

  const treeView = vscode.window.createTreeView('myTreeView', {
    treeDataProvider,
    showCollapseAll: true
  });

  context.subscriptions.push(treeView);

  // Register refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand('extension.refreshTree', () => {
      treeDataProvider.refresh();
    })
  );

  // Register open item command
  context.subscriptions.push(
    vscode.commands.registerCommand('extension.openItem', (item: MyTreeItem) => {
      vscode.window.showInformationMessage(`Opened: ${item.label}`);
    })
  );
}
```

### Tree View in package.json
```json
{
  "contributes": {
    "views": {
      "explorer": [
        {
          "id": "myTreeView",
          "name": "My Tree View"
        }
      ]
    },
    "menus": {
      "view/title": [
        {
          "command": "extension.refreshTree",
          "when": "view == myTreeView",
          "group": "navigation"
        }
      ],
      "view/item/context": [
        {
          "command": "extension.deleteItem",
          "when": "view == myTreeView && viewItem == myTreeItem",
          "group": "inline"
        }
      ]
    }
  }
}
```

## Testing

### Basic Test
```typescript
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
  vscode.window.showInformationMessage('Start all tests.');

  test('Extension should be present', () => {
    const ext = vscode.extensions.getExtension('publisher.extension-name');
    assert.ok(ext);
  });

  test('Extension should activate', async () => {
    const ext = vscode.extensions.getExtension('publisher.extension-name');
    await ext?.activate();
    assert.strictEqual(ext?.isActive, true);
  });

  test('Command should be registered', async () => {
    const commands = await vscode.commands.getCommands();
    assert.ok(commands.includes('extension.helloWorld'));
  });

  test('Command should execute', async () => {
    await vscode.commands.executeCommand('extension.helloWorld');
    // Assert expected behavior
  });

  test('Should open and read file', async () => {
    const uri = vscode.Uri.file('/path/to/test/file.txt');
    const document = await vscode.workspace.openTextDocument(uri);
    assert.ok(document);
    assert.strictEqual(document.languageId, 'plaintext');
  });
});
```

## Bundling with esbuild

### package.json scripts
```json
{
  "scripts": {
    "vscode:prepublish": "npm run package",
    "compile": "npm run check-types && node esbuild.js",
    "watch": "npm-run-all -p watch:*",
    "watch:esbuild": "node esbuild.js --watch",
    "watch:tsc": "tsc --noEmit --watch --project tsconfig.json",
    "package": "npm run check-types && node esbuild.js --production",
    "check-types": "tsc --noEmit"
  }
}
```

### esbuild.js
```javascript
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'out/extension.js',
    external: ['vscode'],
    logLevel: 'silent',
    plugins: [
      /* Add plugins here */
      esbuildProblemMatcherPlugin
    ]
  });

  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',

  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd(result => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      });
      console.log('[watch] build finished');
    });
  }
};

main().catch(e => {
  console.error(e);
  process.exit(1);
});
```

### .vscodeignore
```
.vscode/**
.vscode-test/**
src/**
.gitignore
.yarnrc
vsc-extension-quickstart.md
**/tsconfig.json
**/.eslintrc.json
**/*.map
**/*.ts
node_modules/**
!node_modules/required-dep/**
```

## Common Codicons

Use these icons in UI: `$(icon-name)`

- Files: `file`, `folder`, `folder-opened`
- Actions: `add`, `remove`, `edit`, `trash`, `refresh`
- Status: `check`, `x`, `warning`, `error`, `info`
- Code: `symbol-method`, `symbol-class`, `symbol-variable`
- Navigation: `arrow-right`, `arrow-left`, `chevron-down`, `chevron-right`
- Tools: `gear`, `search`, `filter`, `debug`, `beaker`

Full list: https://microsoft.github.io/vscode-codicons/dist/codicon.html
