# The managed OpenModelica lives in the user's home directory, and `modelica.omcPath` is never written

A managed installation has to live somewhere and the extension has to find it again. We
install to `~/.openmodelica/modelica-wrapper` — inside the directory OpenModelica already
owns, in a subdirectory this extension exclusively owns — and we **never write
`modelica.omcPath`**. Resolution is instead ordered: an explicit `modelica.omcPath` wins;
otherwise the managed installation if present; otherwise `PATH`.

Both halves look wrong at a glance, which is why they are recorded here.

## Why not `globalStorageUri`

It is the obvious choice, and the usual argument for it — that VS Code reclaims it on
uninstall — is **false**. VS Code does not delete extension global storage when an
extension is uninstalled (microsoft/vscode#156519, #272442); third-party extensions exist
solely to clean it up. Choosing it would silently strand 3 GB in a path no user will ever
look in.

A home-directory location is discoverable, removable by hand, and shared across VS Code
installations and profiles rather than duplicated once per profile. The extension owns only
the subdirectory, which is what makes "only ever delete a prefix we created" a guarantee
rather than a hope.

## Why the setting is never written

Writing the resolved path into `modelica.omcPath` is the natural-looking thing to do, and
it breaks four ways:

- **Settings Sync** propagates `settings.json` between machines. A machine-specific absolute
  path written on one machine arrives on another where it does not exist, breaking an
  installation the user never touched.
- Version updates replace the prefix, so every update would have to rewrite the user's
  settings file.
- Removing the managed installation would leave the setting pointing at a deleted path, or
  require un-writing it.
- A workspace-level `omcPath` committed by a colleague would be clobbered, or silently win,
  and neither is defensible.

Under the precedence rule all four disappear, because the setting only ever contains what a
human typed.

## Consequences

Resolution becomes invisible — nothing in the settings file says which `omc` is in use. This
is repaid by the status bar item, which names the resolved binary and its compatibility
verdict rather than making the user reason about precedence.

A user following unrelated OpenModelica troubleshooting advice may delete `~/.openmodelica`
wholesale and take the managed installation with it. This fails safe: detection reports no
managed install and the extension offers to install again.

A user who uninstalls the extension without running the removal command still leaves the
prefix behind. Disclosing the install path up front mitigates this; nothing solves it.
