#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import https from "https";
import { randomUUID } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, ".env") });

const CODECKS_TOKEN = process.env.CODECKS_TOKEN;
const CODECKS_DEFAULT_PROJECT = process.env.CODECKS_DEFAULT_PROJECT; // Optional: default project filter (can be overridden per-call)
const CODECKS_USER_ID = process.env.CODECKS_USER_ID; // Required for create operations

// Parse CODECKS_URL to extract account subdomain (e.g., "kaia.codecks.io" -> "kaia")
const CODECKS_URL = process.env.CODECKS_URL || "";
const CODECKS_ACCOUNT = CODECKS_URL.replace(/^https?:\/\//, "").split(".")[0];

if (!CODECKS_TOKEN || !CODECKS_ACCOUNT) {
  console.error("Missing CODECKS_TOKEN or CODECKS_URL in .env file");
  process.exit(1);
}

// Cache for project name -> ID resolution
let projectCache = null;

async function getProjectIdByName(projectName) {
  if (!projectCache) {
    const projects = await listProjectsInternal();
    projectCache = {};
    for (const p of projects) {
      projectCache[p.name.toLowerCase()] = p.id;
    }
  }
  return projectCache[projectName.toLowerCase()] || null;
}

async function getDeckIdByName(deckName, projectName = null) {
  const decks = await listDecks(projectName);
  const match = decks.find(
    (d) => d.title.toLowerCase() === deckName.toLowerCase()
  );
  return match ? match.id : null;
}

async function listProjectsInternal() {
  const query = {
    _root: [
      {
        account: [
          {
            projects: ["name"],
          },
        ],
      },
    ],
  };
  const result = await queryCodecks(query);
  const accountData = result?.account
    ? Object.values(result.account)[0]
    : null;
  const projectIds = accountData?.projects || [];
  const projectData = result?.project || {};

  return projectIds.map((id) => ({
    id,
    name: projectData[id]?.name || "",
  }));
}

function parseApiError(statusCode, body) {
  if (statusCode === 401 || statusCode === 403) {
    return new Error("Authentication failed. Your token may have expired - get a fresh token from your browser cookies.");
  }
  if (statusCode === 429) {
    return new Error("Rate limited by Codecks API. Please wait before retrying.");
  }

  // Try to extract error message from response
  try {
    const parsed = JSON.parse(body);
    if (parsed.error) return new Error(parsed.error);
    if (parsed.message) return new Error(parsed.message);
  } catch {}

  return new Error(`Codecks API error: ${statusCode} - ${body.slice(0, 200)}`);
}

async function queryCodecks(query) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query });

    const options = {
      hostname: "api.codecks.io",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": `at=${CODECKS_TOKEN}`,
        "X-Account": CODECKS_ACCOUNT,
        "Content-Length": Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          reject(parseApiError(res.statusCode, body));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Failed to parse response: ${e.message}`));
        }
      });
    });

    req.on("error", (err) => reject(new Error(`Network error: ${err.message}`)));
    req.write(data);
    req.end();
  });
}

async function dispatchCodecks(path, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);

    const options = {
      hostname: "api.codecks.io",
      path: `/dispatch/${path}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": `at=${CODECKS_TOKEN}`,
        "X-Account": CODECKS_ACCOUNT,
        "Content-Length": Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          reject(parseApiError(res.statusCode, body));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Failed to parse response: ${e.message}`));
        }
      });
    });

    req.on("error", (err) => reject(new Error(`Network error: ${err.message}`)));
    req.write(data);
    req.end();
  });
}

async function listCards(deckName = null, projectName = null, statusFilter = null) {
  let allowedDeckIds = null; // null means all decks allowed
  const targetProject = projectName || CODECKS_DEFAULT_PROJECT;

  // If a project name is specified (or default configured), resolve to ID and get its non-deleted deck IDs
  if (targetProject) {
    const projectId = await getProjectIdByName(targetProject);
    if (!projectId) {
      throw new Error(`Project "${targetProject}" not found`);
    }

    const projectQuery = {
      [`project(${projectId})`]: [{ decks: ["title", "isDeleted"] }],
    };
    const projectResult = await queryCodecks(projectQuery);
    const projectData = projectResult?.project?.[projectId];
    const projectDeckData = projectResult?.deck || {};

    // Only include non-deleted decks from this project
    allowedDeckIds = new Set(
      (projectData?.decks || []).filter(deckId => !projectDeckData[deckId]?.isDeleted)
    );
  }

  // Get all cards with deck relation and derivedStatus for filtering
  const cardsQuery = {
    _root: [
      {
        account: [
          {
            cards: [
              "title",
              "content",
              "derivedStatus",
              { deck: ["title", "isDeleted"] },
            ],
          },
        ],
      },
    ],
  };
  const cardsResult = await queryCodecks(cardsQuery);
  const accountData = cardsResult?.account
    ? Object.values(cardsResult.account)[0]
    : null;
  const cardIds = accountData?.cards || [];
  const cardData = cardsResult?.card || {};
  const deckData = cardsResult?.deck || {};

  // Filter cards, excluding archived/deleted
  let cards = cardIds
    .map((cardId) => {
      const card = cardData[cardId] || {};
      const deckId = card.deck;
      const deck = deckId ? deckData[deckId] : null;
      return {
        id: cardId,
        title: card.title || "",
        content: card.content || "",
        deckId: deckId,
        deck: deck?.title || null,
        deckDeleted: deck?.isDeleted || false,
        derivedStatus: card.derivedStatus || "",
      };
    })
    .filter((card) => {
      // If project filter is set, must be in that project's decks
      if (allowedDeckIds && (!card.deckId || !allowedDeckIds.has(card.deckId))) return false;
      // Exclude cards from deleted decks
      if (card.deckDeleted) return false;
      // Exclude archived and deleted cards
      const status = card.derivedStatus.toLowerCase();
      if (status.includes("archived") || status.includes("deleted")) return false;
      return true;
    })
    .map(({ deckId, deckDeleted, ...card }) => card); // Remove internal fields

  if (statusFilter) {
    const filterLower = statusFilter.toLowerCase();
    cards = cards.filter((card) =>
      card.derivedStatus?.toLowerCase().includes(filterLower)
    );
  }

  if (deckName) {
    cards = cards.filter((card) =>
      card.deck?.toLowerCase().includes(deckName.toLowerCase())
    );
  }

  return cards;
}

async function searchCards(searchTerm, projectName = null) {
  const cards = await listCards(null, projectName);
  const term = searchTerm.toLowerCase();

  return cards.filter(
    (card) =>
      card.title?.toLowerCase().includes(term) ||
      card.content?.toLowerCase().includes(term)
  );
}

async function getCard(cardId) {
  const cards = await listCards();
  return cards.find((card) => card.id === cardId) || null;
}

async function listProjects() {
  return listProjectsInternal();
}

async function listDecks(projectName = null) {
  const targetProjectName = projectName || CODECKS_DEFAULT_PROJECT;
  if (!targetProjectName) {
    throw new Error("No project specified. Set CODECKS_DEFAULT_PROJECT in .env or pass a project name.");
  }

  const projectId = await getProjectIdByName(targetProjectName);
  if (!projectId) {
    throw new Error(`Project "${targetProjectName}" not found`);
  }

  const query = {
    [`project(${projectId})`]: [
      "spaces",
      { decks: ["title", "isDeleted", "spaceId", { cards: ["derivedStatus"] }] },
    ],
  };
  const result = await queryCodecks(query);
  const projectData = result?.project?.[projectId];
  const deckData = result?.deck || {};
  const cardData = result?.card || {};
  const spaces = projectData?.spaces || [];

  return (projectData?.decks || [])
    .filter(deckId => !deckData[deckId]?.isDeleted)
    .map(deckId => {
      const deck = deckData[deckId] || {};
      const cardIds = deck.cards || [];
      const activeCards = cardIds.filter((cid) => {
        const status = (cardData[cid]?.derivedStatus || "").toLowerCase();
        return !status.includes("archived") && !status.includes("deleted");
      });
      const space = spaces.find((s) => s.id === deck.spaceId);
      return {
        id: deckId,
        title: deck.title || "",
        cardCount: activeCards.length,
        spaceId: deck.spaceId || 1,
        spaceName: space?.name || null,
      };
    });
}

async function createCard(content, deckId) {
  if (!CODECKS_USER_ID) {
    throw new Error("CODECKS_USER_ID is required in .env for create operations");
  }

  const payload = {
    sessionId: randomUUID(),
    userId: CODECKS_USER_ID,
    content,
    deckId,
    assigneeId: null,
    addAsBookmark: false,
    attachments: [],
    childCards: [],
    effort: null,
    fakeCoverFileId: null,
    inDeps: [],
    isDoc: false,
    masterTags: [],
    milestoneId: null,
    outDeps: [],
    parentCardId: null,
    priority: null,
    putInQueue: false,
    sprintId: null,
    subscribeCreator: false,
  };

  const result = await dispatchCodecks("cards/create", payload);
  return result;
}

async function createDeck(title, projectName = null, spaceId = null) {
  if (!CODECKS_USER_ID) {
    throw new Error("CODECKS_USER_ID is required in .env for create operations");
  }

  const targetProjectName = projectName || CODECKS_DEFAULT_PROJECT;
  if (!targetProjectName) {
    throw new Error("No project specified. Set CODECKS_DEFAULT_PROJECT in .env or pass a project name.");
  }

  const projectId = await getProjectIdByName(targetProjectName);
  if (!projectId) {
    throw new Error(`Project "${targetProjectName}" not found`);
  }

  const payload = {
    sessionId: randomUUID(),
    userId: CODECKS_USER_ID,
    title,
    projectId,
    coverFileData: null,
    spaceId: spaceId || 1,
  };

  const result = await dispatchCodecks("decks/create", payload);
  return result;
}

async function createProject(name) {
  const payload = {
    sessionId: randomUUID(),
    name,
    fileId: null,
    defaultUserAccess: "everyone",
    template: null,
  };

  const result = await dispatchCodecks("projects/create", payload);
  return result;
}

async function updateCard(cardId, content) {
  if (!CODECKS_USER_ID) {
    throw new Error("CODECKS_USER_ID is required in .env for update operations");
  }
  if (!cardId || typeof cardId !== "string") {
    throw new Error("cardId is required and must be a string");
  }
  if (!content || typeof content !== "string") {
    throw new Error("content is required and must be a string");
  }

  const payload = {
    sessionId: randomUUID(),
    userId: CODECKS_USER_ID,
    id: cardId,
    content,
  };

  const result = await dispatchCodecks("cards/update", payload);
  return result;
}

async function moveCard(cardId, deckId) {
  if (!cardId || typeof cardId !== "string") {
    throw new Error("cardId is required and must be a string");
  }
  if (!deckId || typeof deckId !== "string") {
    throw new Error("deckId is required and must be a string");
  }

  const payload = {
    sessionId: randomUUID(),
    deckId,
    ids: [cardId],
  };

  const result = await dispatchCodecks("cards/bulkUpdate", payload);
  return result;
}

async function setCardStatus(cardId, status) {
  if (!cardId || typeof cardId !== "string") {
    throw new Error("cardId is required and must be a string");
  }
  if (!status || typeof status !== "string") {
    throw new Error("status is required and must be a string");
  }

  const payload = {
    sessionId: randomUUID(),
    ids: [cardId],
    status,
  };

  const result = await dispatchCodecks("cards/bulkUpdate", payload);
  return result;
}

async function archiveCard(cardId) {
  if (!cardId || typeof cardId !== "string") {
    throw new Error("cardId is required and must be a string");
  }

  const payload = {
    sessionId: randomUUID(),
    id: cardId,
    visibility: "archived",
  };

  const result = await dispatchCodecks("cards/update", payload);
  return result;
}

async function unarchiveCard(cardId) {
  if (!cardId || typeof cardId !== "string") {
    throw new Error("cardId is required and must be a string");
  }

  const payload = {
    sessionId: randomUUID(),
    id: cardId,
    visibility: "default",
  };

  const result = await dispatchCodecks("cards/update", payload);
  return result;
}

async function updateDeck(deckId, title) {
  if (!deckId || typeof deckId !== "string") {
    throw new Error("deckId is required and must be a string");
  }
  if (!title || typeof title !== "string") {
    throw new Error("title is required and must be a string");
  }

  const payload = {
    sessionId: randomUUID(),
    id: deckId,
    title,
  };

  const result = await dispatchCodecks("decks/update", payload);
  return result;
}

async function listSpaces(projectName = null) {
  const targetProjectName = projectName || CODECKS_DEFAULT_PROJECT;
  if (!targetProjectName) {
    throw new Error("No project specified. Set CODECKS_DEFAULT_PROJECT in .env or pass a project name.");
  }

  const projectId = await getProjectIdByName(targetProjectName);
  if (!projectId) {
    throw new Error(`Project "${targetProjectName}" not found`);
  }

  const query = {
    [`project(${projectId})`]: ["spaces"],
  };
  const result = await queryCodecks(query);
  const projectData = result?.project?.[projectId];

  return (projectData?.spaces || []).map((space) => ({
    id: space.id,
    name: space.name,
    icon: space.icon,
    defaultDeckType: space.defaultDeckType,
  }));
}

async function getSpacesForProject(projectName = null) {
  const targetProjectName = projectName || CODECKS_DEFAULT_PROJECT;
  if (!targetProjectName) {
    throw new Error("No project specified.");
  }

  const projectId = await getProjectIdByName(targetProjectName);
  if (!projectId) {
    throw new Error(`Project "${targetProjectName}" not found`);
  }

  const query = {
    [`project(${projectId})`]: ["spaces"],
  };
  const result = await queryCodecks(query);
  const projectData = result?.project?.[projectId];

  return { projectId, spaces: projectData?.spaces || [] };
}

async function createSpace(name, projectName = null) {
  if (!name || typeof name !== "string") {
    throw new Error("name is required and must be a string");
  }

  const { projectId, spaces } = await getSpacesForProject(projectName);
  const maxId = spaces.reduce((max, s) => Math.max(max, s.id), 0);

  const newSpaces = [
    ...spaces,
    { id: maxId + 1, name, icon: null, defaultDeckType: "mixed" },
  ];

  const payload = {
    sessionId: randomUUID(),
    id: projectId,
    spaces: newSpaces,
  };

  const result = await dispatchCodecks("projects/update", payload);
  return result;
}

async function renameSpace(spaceId, name, projectName = null) {
  if (typeof spaceId !== "number") {
    throw new Error("spaceId is required and must be a number");
  }
  if (!name || typeof name !== "string") {
    throw new Error("name is required and must be a string");
  }

  const { projectId, spaces } = await getSpacesForProject(projectName);
  const space = spaces.find((s) => s.id === spaceId);
  if (!space) {
    throw new Error(`Space with ID ${spaceId} not found`);
  }

  const newSpaces = spaces.map((s) =>
    s.id === spaceId ? { ...s, name } : s
  );

  const payload = {
    sessionId: randomUUID(),
    id: projectId,
    spaces: newSpaces,
  };

  const result = await dispatchCodecks("projects/update", payload);
  return result;
}

async function deleteSpace(spaceId, projectName = null) {
  if (typeof spaceId !== "number") {
    throw new Error("spaceId is required and must be a number");
  }
  if (spaceId === 1) {
    throw new Error("Cannot delete the default space (ID 1)");
  }

  const { projectId, spaces } = await getSpacesForProject(projectName);
  const space = spaces.find((s) => s.id === spaceId);
  if (!space) {
    throw new Error(`Space with ID ${spaceId} not found`);
  }

  const newSpaces = spaces.filter((s) => s.id !== spaceId);

  const payload = {
    sessionId: randomUUID(),
    id: projectId,
    spaces: newSpaces,
  };

  const result = await dispatchCodecks("projects/update", payload);
  return result;
}

const server = new Server(
  {
    name: "codecks-mcp",
    version: "1.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "codecks_list_cards",
        description:
          "List all cards from Codecks. Optionally filter by deck name, project, and/or status. Returns derivedStatus for each card.",
        inputSchema: {
          type: "object",
          properties: {
            deck: {
              type: "string",
              description: "Optional deck name to filter by",
            },
            project: {
              type: "string",
              description: "Optional project name to filter by. Overrides CODECKS_DEFAULT_PROJECT.",
            },
            status: {
              type: "string",
              description: "Optional status filter. Common values: 'started', 'done'. Only cards matching this status will be returned.",
            },
          },
        },
      },
      {
        name: "codecks_search_cards",
        description: "Search cards by title or content within a project.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search term to find in card titles or content",
            },
            project: {
              type: "string",
              description: "Optional project name to search within. Overrides CODECKS_DEFAULT_PROJECT.",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "codecks_get_card",
        description: "Get a specific card by its ID",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "The card ID",
            },
          },
          required: ["id"],
        },
      },
      {
        name: "codecks_list_projects",
        description: "List all Codecks projects with their IDs. Use this to find a project ID for configuration.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "codecks_list_decks",
        description: "List all decks in a project with card counts and space info. Uses default project if not specified.",
        inputSchema: {
          type: "object",
          properties: {
            project: {
              type: "string",
              description: "Optional project name. Uses CODECKS_DEFAULT_PROJECT from config if not provided.",
            },
          },
        },
      },
      {
        name: "codecks_create_card",
        description: "Create a new card in a deck. Specify either deckId or deckName (with optional project for name resolution).",
        inputSchema: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "The card content/title",
            },
            deckId: {
              type: "string",
              description: "The deck ID to create the card in. Either deckId or deckName must be provided.",
            },
            deckName: {
              type: "string",
              description: "The deck name to create the card in (resolved to ID internally). Either deckId or deckName must be provided.",
            },
            project: {
              type: "string",
              description: "Project name for deck name resolution. Uses default project if not specified.",
            },
          },
          required: ["content"],
        },
      },
      {
        name: "codecks_create_deck",
        description: "Create a new deck in a project, optionally in a specific space.",
        inputSchema: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "The deck title",
            },
            project: {
              type: "string",
              description: "Optional project name. Uses CODECKS_DEFAULT_PROJECT from config if not provided.",
            },
            spaceId: {
              type: "number",
              description: "Optional space ID to create the deck in. Defaults to space 1 if not specified.",
            },
          },
          required: ["title"],
        },
      },
      {
        name: "codecks_create_project",
        description: "Create a new project in the Codecks organization.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "The project name",
            },
          },
          required: ["name"],
        },
      },
      {
        name: "codecks_update_card",
        description: "Update the content of an existing card.",
        inputSchema: {
          type: "object",
          properties: {
            cardId: {
              type: "string",
              description: "The card ID to update",
            },
            content: {
              type: "string",
              description: "The new card content",
            },
          },
          required: ["cardId", "content"],
        },
      },
      {
        name: "codecks_move_card",
        description: "Move a card to a different deck.",
        inputSchema: {
          type: "object",
          properties: {
            cardId: {
              type: "string",
              description: "The card ID to move",
            },
            deckId: {
              type: "string",
              description: "The destination deck ID",
            },
          },
          required: ["cardId", "deckId"],
        },
      },
      {
        name: "codecks_complete_card",
        description: "Mark a card as complete or incomplete.",
        inputSchema: {
          type: "object",
          properties: {
            cardId: {
              type: "string",
              description: "The card ID",
            },
            complete: {
              type: "boolean",
              description: "True to mark complete, false to mark incomplete",
            },
          },
          required: ["cardId", "complete"],
        },
      },
      {
        name: "codecks_archive_card",
        description: "Archive a card. Use this for cards that are done and no longer needed in active view.",
        inputSchema: {
          type: "object",
          properties: {
            cardId: {
              type: "string",
              description: "The card ID to archive",
            },
          },
          required: ["cardId"],
        },
      },
      {
        name: "codecks_unarchive_card",
        description: "Unarchive a card, making it visible again. Use this to undo an accidental archive.",
        inputSchema: {
          type: "object",
          properties: {
            cardId: {
              type: "string",
              description: "The card ID to unarchive",
            },
          },
          required: ["cardId"],
        },
      },
      {
        name: "codecks_update_deck",
        description: "Rename a deck by updating its title.",
        inputSchema: {
          type: "object",
          properties: {
            deckId: {
              type: "string",
              description: "The deck ID to rename",
            },
            title: {
              type: "string",
              description: "The new deck title",
            },
          },
          required: ["deckId", "title"],
        },
      },
      {
        name: "codecks_list_spaces",
        description: "List all spaces in a project. Spaces are containers for organizing decks.",
        inputSchema: {
          type: "object",
          properties: {
            project: {
              type: "string",
              description: "Optional project name. Uses CODECKS_DEFAULT_PROJECT from config if not provided.",
            },
          },
        },
      },
      {
        name: "codecks_create_space",
        description: "Create a new space in a project. Spaces are containers for organizing decks.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "The space name",
            },
            project: {
              type: "string",
              description: "Optional project name. Uses CODECKS_DEFAULT_PROJECT from config if not provided.",
            },
          },
          required: ["name"],
        },
      },
      {
        name: "codecks_rename_space",
        description: "Rename a space in a project.",
        inputSchema: {
          type: "object",
          properties: {
            spaceId: {
              type: "number",
              description: "The space ID (integer) to rename",
            },
            name: {
              type: "string",
              description: "The new space name",
            },
            project: {
              type: "string",
              description: "Optional project name. Uses CODECKS_DEFAULT_PROJECT from config if not provided.",
            },
          },
          required: ["spaceId", "name"],
        },
      },
      {
        name: "codecks_delete_space",
        description: "Delete a space from a project. Cannot delete the default space (ID 1).",
        inputSchema: {
          type: "object",
          properties: {
            spaceId: {
              type: "number",
              description: "The space ID (integer) to delete",
            },
            project: {
              type: "string",
              description: "Optional project name. Uses CODECKS_DEFAULT_PROJECT from config if not provided.",
            },
          },
          required: ["spaceId"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;

    switch (name) {
      case "codecks_list_cards":
        result = await listCards(args?.deck, args?.project, args?.status);
        break;
      case "codecks_search_cards":
        result = await searchCards(args.query, args?.project);
        break;
      case "codecks_get_card":
        result = await getCard(args.id);
        break;
      case "codecks_list_projects":
        result = await listProjects();
        break;
      case "codecks_list_decks":
        result = await listDecks(args?.project);
        break;
      case "codecks_create_card": {
        let deckId = args.deckId;
        if (!deckId && args.deckName) {
          deckId = await getDeckIdByName(args.deckName, args?.project);
          if (!deckId) throw new Error(`Deck "${args.deckName}" not found`);
        }
        if (!deckId) throw new Error("Either deckId or deckName must be provided");
        result = await createCard(args.content, deckId);
        break;
      }
      case "codecks_create_deck":
        result = await createDeck(args.title, args?.project, args?.spaceId);
        break;
      case "codecks_create_project":
        result = await createProject(args.name);
        break;
      case "codecks_update_card":
        result = await updateCard(args.cardId, args.content);
        break;
      case "codecks_move_card":
        result = await moveCard(args.cardId, args.deckId);
        break;
      case "codecks_complete_card":
        result = await setCardStatus(args.cardId, args.complete ? "done" : "started");
        break;
      case "codecks_archive_card":
        result = await archiveCard(args.cardId);
        break;
      case "codecks_unarchive_card":
        result = await unarchiveCard(args.cardId);
        break;
      case "codecks_update_deck":
        result = await updateDeck(args.deckId, args.title);
        break;
      case "codecks_list_spaces":
        result = await listSpaces(args?.project);
        break;
      case "codecks_create_space":
        result = await createSpace(args.name, args?.project);
        break;
      case "codecks_rename_space":
        result = await renameSpace(args.spaceId, args.name, args?.project);
        break;
      case "codecks_delete_space":
        result = await deleteSpace(args.spaceId, args?.project);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Codecks MCP server running");
}

main().catch(console.error);
