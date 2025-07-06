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
        isPublic: true, // Main tab is always public
        createdBy: "system", // Belongs to the system
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
    // Ensure new tabs are private by default and have a creator
    const newTab = {
      ...tab,
      isPublic: false,
      createdBy: tab.createdBy || "system",
    };
    this.tabs.push(newTab);
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

  deleteTab(tabId, userId) {
    const tab = this.getTab(tabId);
    // Prevent deleting main tab, system tabs, or if the user is not the owner
    if (
      !tab ||
      tab.id === "main" ||
      tab.createdBy === "system" ||
      tab.createdBy !== userId
    ) {
      return { success: false, reason: "Not authorized or system tab" };
    }

    const index = this.tabs.findIndex((t) => t.id === tabId);
    if (index !== -1) {
      this.tabs.splice(index, 1);
      let newActiveTab = this.activeTab;
      if (this.activeTab === tabId) {
        newActiveTab = this.tabs[0].id;
        this.activeTab = newActiveTab;
      }
      this.lastActivity = new Date();
      return { success: true, newActiveTab: newActiveTab };
    }
    return { success: false, reason: "Tab not found" };
  }

  setTabPublic(tabId, isPublic, userId) {
    const tab = this.getTab(tabId);
    // Only allow owner to change privacy, prevent changing main tab privacy
    if (tab && tab.createdBy === userId && tab.id !== "main") {
      tab.isPublic = isPublic;
      this.lastActivity = new Date();
      return { success: true, tab };
    }
    return { success: false, reason: "Not authorized or main tab" };
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
