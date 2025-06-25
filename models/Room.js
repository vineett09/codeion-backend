const { v4: uuidv4 } = require("uuid");

class Room {
  constructor(id, name, language, isPrivate, createdBy) {
    this.id = id;
    this.name = name;
    this.language = language;
    this.isPrivate = isPrivate;
    this.createdBy = createdBy;
    this.users = [];
    this.tabs = [
      {
        id: "main",
        name: "Main",
        code: this.getDefaultCode(language),
        language: language,
      },
    ];
    this.activeTab = "main";
    this.createdAt = new Date();
    this.lastActivity = new Date();
  }

  getDefaultCode(language) {
    const templates = {
      javascript:
        '// Welcome to the collaborative editor!\nconsole.log("Hello, World!");',
      typescript:
        '// Welcome to the collaborative editor!\nconst message: string = "Hello, World!";\nconsole.log(message);',
      python: '# Welcome to the collaborative editor!\nprint("Hello, World!")',
      java: '// Welcome to the collaborative editor!\npublic class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}',
      cpp: '// Welcome to the collaborative editor!\n#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello, World!" << endl;\n    return 0;\n}',
      react:
        '// Welcome to the collaborative editor!\nimport React from "react";\n\nfunction App() {\n  return (\n    <div>\n      <h1>Hello, World!</h1>\n    </div>\n  );\n}\n\nexport default App;',
      nodejs:
        '// Welcome to the collaborative editor!\nconst express = require("express");\nconst app = express();\n\napp.get("/", (req, res) => {\n  res.send("Hello, World!");\n});\n\napp.listen(3000, () => {\n  console.log("Server running on port 3000");\n});',
      html: "<!-- Welcome to the collaborative editor! -->\n<!DOCTYPE html>\n<html>\n<head>\n    <title>Hello World</title>\n</head>\n<body>\n    <h1>Hello, World!</h1>\n</body>\n</html>",
    };
    return templates[language] || "// Welcome to the collaborative editor!";
  }

  addUser(user) {
    this.users.push(user);
    this.lastActivity = new Date();
  }

  removeUser(userId) {
    this.users = this.users.filter((user) => user.id !== userId);
    this.lastActivity = new Date();
  }

  addTab(tab) {
    this.tabs.push(tab);
    this.lastActivity = new Date();
  }

  updateTabCode(tabId, code) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (tab) {
      tab.code = code;
      this.lastActivity = new Date();
      return true;
    }
    return false;
  }

  updateTabLanguage(tabId, language) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (tab) {
      tab.language = language;
      this.lastActivity = new Date();
      return true;
    }
    return false;
  }

  getTab(tabId) {
    return this.tabs.find((t) => t.id === tabId);
  }

  deleteTab(tabId) {
    if (this.tabs.length <= 1) return false; // Don't delete last tab
    const index = this.tabs.findIndex((t) => t.id === tabId);
    if (index !== -1) {
      this.tabs.splice(index, 1);
      // If active tab was deleted, switch to first tab
      if (this.activeTab === tabId) {
        this.activeTab = this.tabs[0].id;
      }
      this.lastActivity = new Date();
      return true;
    }
    return false;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      language: this.language,
      isPrivate: this.isPrivate,
      userCount: this.users.length,
      lastActivity: this.lastActivity,
      users: this.users.map((user) => ({
        id: user.id,
        name: user.name,
        color: user.color,
      })),
    };
  }
}

module.exports = Room;
