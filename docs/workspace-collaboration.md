## Workspace Collaboration Model

This is the collaboration shape PostFreely is moving toward for cloud mode.

### Goals

- Users can create multiple workspaces.
- Collections can belong to a workspace.
- Workspaces can be shared with registered users by email.
- Workspace roles are:
  - `owner`
  - `admin`
  - `collaborator`
- Only `owner` and `admin` can add or remove members.
- All members can work on collections.
- Member edits stay local to that member until they explicitly promote them.
- Environment variables and collection variables do **not** get promoted to the shared main collection.

### Tables

- `pf_workspaces`
  - shared workspace shell
- `pf_workspace_members`
  - membership and role mapping
- `pf_workspace_collections`
  - collection-to-workspace assignment
- `pf_collection_drafts`
  - per-user editable draft version of a shared collection

### Draft Promotion Rule

Shared collections should behave like this:

- Main collection:
  - the shared baseline everyone can read
- Personal draft:
  - a collaborator's private working copy for a specific collection
- Promote to main:
  - copies only collection-safe fields back into the main collection
  - allowed:
    - collection name
    - description
    - requests
    - docs metadata
    - AI source settings
  - blocked:
    - collection variables
    - environment variables

This keeps secrets and personal overrides out of the shared baseline.

### Suggested UI

- Small workspace picker in the top bar
- Workspace switcher modal:
  - create workspace
  - invite member by email
  - assign role
  - remove member
- Collection actions:
  - move to workspace
  - open my draft
  - promote draft to main
  - compare against main

### Rollout Order

1. Add workspace tables and RLS
2. Add cloud API methods for workspaces and memberships
3. Add collection assignment to workspace
4. Add draft save/load
5. Add promote-to-main flow
6. Add compare/review UI

### Security Notes

- Promotion intentionally excludes variables.
- Membership changes are restricted to workspace admins.
- Draft rows are private to the editor, except for workspace admins.
- Shared main collections stay auditable and predictable.
