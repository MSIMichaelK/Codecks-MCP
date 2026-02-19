# Codecks MCP Server

An MCP (Model Context Protocol) server that lets AI assistants interact with [Codecks](https://codecks.io) project management. Query cards, create tasks, update status, and manage your game dev workflow directly from Claude or other MCP-compatible AI tools.

## Features

- **List & Search Cards** - Query all cards or filter by deck/project/status, search by title/content
- **Create Cards & Decks** - Add new tasks directly from your AI assistant, reference decks by name or ID
- **Update Cards** - Modify card content, move between decks, rename decks
- **Status Management** - Mark cards complete, archive/unarchive finished work
- **Space Management** - List, create, rename, and delete spaces (deck containers)
- **Flexible Project Filtering** - Set a default project or specify per-call for cross-project workflows

## Installation

1. Place the `codecks-mcp` folder wherever you like
2. Install dependencies:
   ```bash
   cd codecks-mcp
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in your credentials:
   - **Mac/Linux:** `cp .env.example .env`
   - **Windows:** `copy .env.example .env`

## Configuration

Edit `.env` with your Codecks credentials:

```env
# Required: Your auth token (see below for how to find it)
CODECKS_TOKEN=your_token_here

# Required: Your Codecks organization URL
CODECKS_URL=yourteam.codecks.io

# Optional: Default project filter (can be overridden per-call)
CODECKS_DEFAULT_PROJECT=My Project

# Required for create/update operations
CODECKS_USER_ID=your_user_id_here
```

### Finding Your Token

1. Open your Codecks organization in your browser
2. Press F12 to open Developer Tools
3. Go to **Application** tab > **Cookies** > your codecks domain
4. Find the cookie named `at` and copy its value

### Finding Your User ID

1. Open Developer Tools (F12) > **Network** tab
2. Create any card in Codecks
3. Find the request to `api.codecks.io/dispatch/cards/create`
4. Look at the request payload - the `userId` field is your user ID

## Usage with Claude Code

Add to your `.claude/settings.json`:

```json
{
  "mcpServers": {
    "codecks": {
      "command": "node",
      "args": ["/path/to/codecks-mcp/index.js"],
      "cwd": "/path/to/codecks-mcp"
    }
  }
}
```

Optionally, prevent Claude from reading your credentials:

```json
{
  "deny": ["path/to/codecks-mcp/.env"]
}
```

## Available Tools

### Cards

| Tool | Description |
|------|-------------|
| `codecks_list_cards` | List all cards, optionally filter by deck name, project, and/or status |
| `codecks_search_cards` | Search cards by title or content |
| `codecks_get_card` | Get a specific card by ID |
| `codecks_create_card` | Create a new card in a deck (by ID or name) |
| `codecks_update_card` | Update card content |
| `codecks_move_card` | Move a card to a different deck |
| `codecks_complete_card` | Mark a card as complete or incomplete |
| `codecks_archive_card` | Archive a card |
| `codecks_unarchive_card` | Unarchive a card, making it visible again |

### Decks

| Tool | Description |
|------|-------------|
| `codecks_list_decks` | List all decks in a project with card counts and space info |
| `codecks_create_deck` | Create a new deck, optionally in a specific space |
| `codecks_update_deck` | Rename a deck |

### Spaces

| Tool | Description |
|------|-------------|
| `codecks_list_spaces` | List all spaces in a project |
| `codecks_create_space` | Create a new space (deck container) |
| `codecks_rename_space` | Rename a space |
| `codecks_delete_space` | Delete a space (cannot delete the default space) |

### Projects

| Tool | Description |
|------|-------------|
| `codecks_list_projects` | List all projects in your organization |
| `codecks_create_project` | Create a new project |

## Example Prompts

Once configured, you can ask Claude things like:

- "What cards are in my backlog?"
- "Show me all started cards"
- "Create a card for implementing the save system in the Ideas deck"
- "Mark the authentication card as complete"
- "Move the UI polish card to the In Progress deck"
- "Show me all cards in the other project"
- "Create a deck called 'Sprint 1' in the Design space"
- "What spaces are in this project?"
- "Rename the Art deck to Art Assets"

## Token Expiration

The `at` cookie token may expire. If you start getting authentication errors, grab a fresh token from your browser cookies.

## License

MIT
