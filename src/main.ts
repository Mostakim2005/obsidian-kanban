import { around } from 'monkey-around';
import {
  MarkdownView,
  Platform,
  Plugin,
  PluginSettingTab,
  TFile,
  TFolder,
  ViewState,
  WorkspaceLeaf,
} from 'obsidian';

import { KanbanView, kanbanIcon, kanbanViewType } from './KanbanView';
import type { KanbanSettings } from './SettingsSchema';
import type { StateManager } from './StateManager';
import type { BoardRuntime, KanbanBoardChunk } from './chunks/board';
import type { KanbanLocalesChunk } from './chunks/locales';
import type { KanbanSettingsChunk } from './chunks/settings';
import { setActiveFlatpickrLocale } from './components/Editor/datePickerLocale';
import { clearLoadedChunks, loadPluginChunkAsync } from './core/chunk-loader';
import { hasFrontmatterKey } from './helpers/frontmatter';
import { getRequestedLocaleCode, setActiveLocale, t } from './lang/helpers';
import { basicFrontmatter, frontmatterKey } from './parsers/constants';

const BOARD_CHUNK = 'kanban-board.chunk.js';
const SETTINGS_CHUNK = 'kanban-settings.chunk.js';
const LOCALES_CHUNK = 'kanban-locales.chunk.js';

class LazyKanbanSettingsTab extends PluginSettingTab {
  plugin: KanbanPlugin;
  private activeManager: { cleanUp?: () => void } | null = null;

  constructor(plugin: KanbanPlugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('kanban-plugin__board-settings-modal');
    const loadingEl = containerEl.createDiv({ text: 'Loading Kanban settings...' });

    void (async () => {
      await Promise.all([this.plugin.ensureSettingsReady(), this.plugin.ensureLocaleReady()]);
      const settingsChunk = await loadPluginChunkAsync<KanbanSettingsChunk>(
        this.plugin,
        SETTINGS_CHUNK
      );
      loadingEl.remove();
      this.activeManager?.cleanUp?.();
      this.activeManager = settingsChunk.mountGlobalSettingsUI(
        this.plugin,
        containerEl,
        t('Kanban Plugin'),
        {
          onSettingsChange: async (newSettings) => {
            await this.plugin.ensureSettingsReady();
            this.plugin.settings = newSettings;
            await this.plugin.saveSettings();
            this.plugin.stateManagers.forEach((stateManager) => {
              stateManager.forceRefresh();
            });
          },
        }
      );
    })();
  }

  hide() {
    this.activeManager?.cleanUp?.();
    this.activeManager = null;
  }
}

export default class KanbanPlugin extends Plugin {
  settingsTab: LazyKanbanSettingsTab;
  settings: KanbanSettings = {};

  kanbanFileModes: Record<string, string> = {};
  stateManagers: Map<TFile, StateManager> = new Map();
  boardRuntime: BoardRuntime | null = null;

  _loaded: boolean = false;
  isShiftPressed: boolean = false;

  private settingsReady: Promise<void> = Promise.resolve();
  private localeReady: Promise<void> = Promise.resolve();
  private boardRuntimePromise: Promise<BoardRuntime> | null = null;

  async loadSettings() {
    this.settings = Object.assign({}, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  ensureSettingsReady(): Promise<void> {
    return this.settingsReady;
  }

  ensureLocaleReady(): Promise<void> {
    return this.localeReady;
  }

  async ensureBoardRuntime(): Promise<BoardRuntime> {
    if (this.boardRuntime) return this.boardRuntime;
    if (!this.boardRuntimePromise) {
      this.boardRuntimePromise = Promise.all([
        this.settingsReady,
        this.localeReady,
        loadPluginChunkAsync<KanbanBoardChunk>(this, BOARD_CHUNK),
      ])
        .then(([, , chunk]) => {
          const rt = chunk.createBoardRuntime(this);
          this.boardRuntime = rt;
          return rt;
        })
        .catch((err) => {
          this.boardRuntimePromise = null;
          throw err;
        });
    }
    return this.boardRuntimePromise;
  }

  async openBoardSettingsModal(view: KanbanView): Promise<void> {
    await Promise.all([this.settingsReady, this.localeReady, this.ensureBoardRuntime()]);
    const settingsChunk = await loadPluginChunkAsync<KanbanSettingsChunk>(this, SETTINGS_CHUNK);
    settingsChunk.openBoardSettings(this, view);
  }

  unload(): void {
    super.unload();
    Promise.all(
      this.app.workspace.getLeavesOfType(kanbanViewType).map((leaf) => {
        this.kanbanFileModes[(leaf as any).id] = 'markdown';
        return this.setMarkdownView(leaf);
      })
    );
  }

  onunload() {
    this.boardRuntime?.destroy();
    this.boardRuntime = null;
    this.boardRuntimePromise = null;
    clearLoadedChunks(this.manifest.id);

    this.stateManagers.clear();
    this.kanbanFileModes = {};

    (this.app.workspace as any).unregisterHoverLinkSource(frontmatterKey);
  }

  get MarkdownEditor(): any {
    return this.boardRuntime ? this.boardRuntime.getMarkdownEditor() : null;
  }

  onload() {
    this.settingsReady = this.loadSettings();

    const lang = getRequestedLocaleCode();
    if (lang && lang !== 'en') {
      this.localeReady = loadPluginChunkAsync<KanbanLocalesChunk>(this, LOCALES_CHUNK)
        .then((mod) => {
          setActiveLocale(mod.resolvePluginLocale(lang));
          const momentLocale = (window as any).moment?.locale?.();
          if (momentLocale && momentLocale !== 'en') {
            setActiveFlatpickrLocale(mod.resolveFlatpickrLocale(momentLocale));
          }
        })
        .catch(() => {
          setActiveLocale(null);
        });
    }

    this.registerEvent(
      this.app.workspace.on('window-close', (_: any, win: Window) => {
        this.boardRuntime?.unmount(win);
      })
    );

    this.settingsTab = new LazyKanbanSettingsTab(this);
    this.addSettingTab(this.settingsTab);

    this.registerView(kanbanViewType, (leaf) => new KanbanView(leaf, this));
    this.registerMonkeyPatches();
    this.registerCommands();
    this.registerEvents();

    this.registerDomEvent(window, 'keydown', this.handleShift);
    this.registerDomEvent(window, 'keyup', this.handleShift);

    this.addRibbonIcon(kanbanIcon, t('Create new board'), () => {
      void this.newKanban();
    });
  }

  handleShift = (e: KeyboardEvent) => {
    this.isShiftPressed = e.shiftKey;
  };

  getKanbanViews(win: Window) {
    return this.boardRuntime ? this.boardRuntime.getKanbanViews(win) : [];
  }

  getKanbanView(id: string, win: Window) {
    return this.boardRuntime ? this.boardRuntime.getKanbanView(id, win) : null;
  }

  getStateManager(file: TFile) {
    return this.stateManagers.get(file);
  }

  getStateManagerFromViewID(id: string, win: Window) {
    const view = this.getKanbanView(id, win);
    if (!view) return null;
    return this.stateManagers.get(view.file);
  }

  useKanbanViews(win: Window): KanbanView[] {
    return this.boardRuntime ? this.boardRuntime.useKanbanViews(win) : [];
  }

  addView(view: KanbanView, data: string, shouldParseData: boolean) {
    this.boardRuntime?.addView(view, data, shouldParseData);
  }

  removeView(view: KanbanView) {
    this.boardRuntime?.removeView(view);
  }

  handleViewFileRename(view: KanbanView, oldPath: string) {
    this.boardRuntime?.handleViewFileRename(view, oldPath);
  }

  mount(win: Window) {
    this.boardRuntime?.mount(win);
  }

  unmount(win: Window) {
    this.boardRuntime?.unmount(win);
  }

  async setMarkdownView(leaf: WorkspaceLeaf, focus: boolean = true) {
    await leaf.setViewState(
      {
        type: 'markdown',
        state: leaf.view.getState(),
        popstate: true,
      } as ViewState,
      { focus }
    );
  }

  async setKanbanView(leaf: WorkspaceLeaf) {
    await leaf.setViewState({
      type: kanbanViewType,
      state: leaf.view.getState(),
      popstate: true,
    } as ViewState);
  }

  async newKanban(folder?: TFolder) {
    const targetFolder = folder
      ? folder
      : this.app.fileManager.getNewFileParent(app.workspace.getActiveFile()?.path || '');

    try {
      const kanban: TFile = await (app.fileManager as any).createNewMarkdownFile(
        targetFolder,
        t('Untitled Kanban')
      );

      await this.app.vault.modify(kanban, basicFrontmatter);
      await this.app.workspace.getLeaf().setViewState({
        type: kanbanViewType,
        state: { file: kanban.path },
      });
    } catch (e) {
      console.error('Error creating kanban board:', e);
    }
  }

  registerEvents() {
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file, source, leaf) => {
        if (source === 'link-context-menu') return;

        const fileIsFile = file instanceof TFile;
        const fileIsFolder = file instanceof TFolder;
        const leafIsMarkdown = leaf?.view instanceof MarkdownView;
        const leafIsKanban = leaf?.view instanceof KanbanView;

        if (fileIsFolder) {
          menu.addItem((item) => {
            item
              .setSection('action-primary')
              .setTitle(t('New kanban board'))
              .setIcon(kanbanIcon)
              .onClick(() => this.newKanban(file));
          });
          return;
        }

        if (
          !Platform.isMobile &&
          fileIsFile &&
          leaf &&
          source === 'sidebar-context-menu' &&
          hasFrontmatterKey(file)
        ) {
          const views = this.getKanbanViews(
            ((leaf.view.containerEl as any).win || window) as Window
          );
          let haveKanbanView = false;

          for (const view of views) {
            if (view.file === file) {
              view.onPaneMenu(menu, 'more-options', false);
              haveKanbanView = true;
              break;
            }
          }

          if (!haveKanbanView) {
            menu.addItem((item) => {
              item
                .setTitle(t('Open as kanban board'))
                .setIcon(kanbanIcon)
                .setSection('pane')
                .onClick(() => {
                  this.kanbanFileModes[(leaf as any).id || file.path] = kanbanViewType;
                  void this.setKanbanView(leaf);
                });
            });

            return;
          }
        }

        if (
          leafIsMarkdown &&
          fileIsFile &&
          ['more-options', 'pane-more-options', 'tab-header'].includes(source) &&
          hasFrontmatterKey(file)
        ) {
          menu.addItem((item) => {
            item
              .setTitle(t('Open as kanban board'))
              .setIcon(kanbanIcon)
              .setSection('pane')
              .onClick(() => {
                this.kanbanFileModes[(leaf as any).id || file.path] = kanbanViewType;
                void this.setKanbanView(leaf);
              });
          });
        }

        if (fileIsFile && leafIsKanban) {
          if (['pane-more-options', 'tab-header'].includes(source)) {
            menu.addItem((item) => {
              item
                .setTitle(t('Open as markdown'))
                .setIcon(kanbanIcon)
                .setSection('pane')
                .onClick(() => {
                  this.kanbanFileModes[(leaf as any).id || file.path] = 'markdown';
                  void this.setMarkdownView(leaf);
                });
            });
          }

          if (Platform.isMobile) {
            const stateManager = this.stateManagers.get(file);
            const kanbanView = leaf.view as KanbanView;
            const boardView =
              kanbanView.viewSettings[frontmatterKey] || stateManager?.getSetting(frontmatterKey);

            menu
              .addItem((item) => {
                item
                  .setTitle(t('Add a list'))
                  .setIcon('lucide-plus-circle')
                  .setSection('pane')
                  .onClick(() => {
                    kanbanView.emitter.emit('showLaneForm', undefined);
                  });
              })
              .addItem((item) => {
                item
                  .setTitle(t('Archive completed cards'))
                  .setIcon('lucide-archive')
                  .setSection('pane')
                  .onClick(() => {
                    stateManager?.archiveCompletedCards();
                  });
              })
              .addItem((item) =>
                item
                  .setTitle(t('View as board'))
                  .setSection('pane')
                  .setIcon('lucide-trello')
                  .setChecked(boardView === 'basic' || boardView === 'board')
                  .onClick(() => kanbanView.setView('board'))
              )
              .addItem((item) =>
                item
                  .setTitle(t('View as table'))
                  .setSection('pane')
                  .setIcon('lucide-table')
                  .setChecked(boardView === 'table')
                  .onClick(() => kanbanView.setView('table'))
              )
              .addItem((item) =>
                item
                  .setTitle(t('View as list'))
                  .setSection('pane')
                  .setIcon('lucide-server')
                  .setChecked(boardView === 'list')
                  .onClick(() => kanbanView.setView('list'))
              )
              .addItem((item) =>
                item
                  .setTitle(t('Open board settings'))
                  .setSection('pane')
                  .setIcon('lucide-settings')
                  .onClick(() => kanbanView.getBoardSettings())
              );
          }
        }
      })
    );

    this.registerEvent(
      app.vault.on('rename', (file, oldPath) => {
        const kanbanLeaves = app.workspace.getLeavesOfType(kanbanViewType);

        kanbanLeaves.forEach((leaf) => {
          (leaf.view as KanbanView).handleRename(file.path, oldPath);
        });
      })
    );

    const notifyFileChange = (file: TFile) => {
      if (this.stateManagers.size === 0) return;
      this.stateManagers.forEach((manager) => {
        if (manager.file !== file) {
          manager.onFileMetadataChange();
        }
      });
    };

    let notifyTimer: number | null = null;
    const scheduleFileNotify = (file: TFile) => {
      if (this.stateManagers.size === 0) return;
      if (notifyTimer !== null) window.clearTimeout(notifyTimer);
      notifyTimer = window.setTimeout(() => {
        notifyTimer = null;
        notifyFileChange(file);
      }, 2000);
    };

    this.registerEvent(
      app.vault.on('modify', (file) => {
        if (file instanceof TFile) {
          scheduleFileNotify(file);
        }
      })
    );

    this.registerEvent(
      app.metadataCache.on('changed', (file) => {
        scheduleFileNotify(file);
      })
    );

    this.registerEvent(
      (app as any).metadataCache.on('dataview:metadata-change', (_: any, file: TFile) => {
        scheduleFileNotify(file);
      })
    );

    this.registerEvent(
      (app as any).metadataCache.on('dataview:api-ready', () => {
        this.stateManagers.forEach((manager) => {
          manager.forceRefresh();
        });
      })
    );

    (app.workspace as any).registerHoverLinkSource(frontmatterKey, {
      display: 'Kanban',
      defaultMod: true,
    });
  }

  registerCommands() {
    this.addCommand({
      id: 'create-new-kanban-board',
      name: t('Create new board'),
      callback: () => this.newKanban(),
    });

    this.addCommand({
      id: 'archive-completed-cards',
      name: t('Archive completed cards in active board'),
      checkCallback: (checking) => {
        const activeView = app.workspace.getActiveViewOfType(KanbanView);

        if (!activeView) return false;
        if (checking) return true;

        this.stateManagers.get(activeView.file).archiveCompletedCards();
      },
    });

    this.addCommand({
      id: 'toggle-kanban-view',
      name: t('Toggle between Kanban and markdown mode'),
      checkCallback: (checking) => {
        const activeFile = app.workspace.getActiveFile();

        if (!activeFile) return false;

        const fileCache = app.metadataCache.getFileCache(activeFile);
        const fileIsKanban = !!fileCache?.frontmatter && !!fileCache.frontmatter[frontmatterKey];

        if (checking) {
          return fileIsKanban;
        }

        const activeView = app.workspace.getActiveViewOfType(KanbanView);

        if (activeView) {
          this.kanbanFileModes[(activeView.leaf as any).id || activeFile.path] = 'markdown';
          void this.setMarkdownView(activeView.leaf);
        } else if (fileIsKanban) {
          const mdView = app.workspace.getActiveViewOfType(MarkdownView);

          if (mdView) {
            this.kanbanFileModes[(mdView.leaf as any).id || activeFile.path] = kanbanViewType;
            void this.setKanbanView(mdView.leaf);
          }
        }
      },
    });

    this.addCommand({
      id: 'convert-to-kanban',
      name: t('Convert empty note to Kanban'),
      checkCallback: (checking) => {
        const activeView = app.workspace.getActiveViewOfType(MarkdownView);

        if (!activeView) return false;

        const isFileEmpty = activeView.file.stat.size === 0;

        if (checking) return isFileEmpty;
        if (isFileEmpty) {
          app.vault
            .modify(activeView.file, basicFrontmatter)
            .then(() => {
              void this.setKanbanView(activeView.leaf);
            })
            .catch((e) => console.error(e));
        }
      },
    });

    this.addCommand({
      id: 'add-kanban-lane',
      name: t('Add a list'),
      checkCallback: (checking) => {
        const view = app.workspace.getActiveViewOfType(KanbanView);

        if (checking) {
          return view && view instanceof KanbanView;
        }

        if (view && view instanceof KanbanView) {
          view.emitter.emit('showLaneForm', undefined);
        }
      },
    });

    this.addCommand({
      id: 'view-board',
      name: t('View as board'),
      checkCallback: (checking) => {
        const view = app.workspace.getActiveViewOfType(KanbanView);

        if (checking) {
          return view && view instanceof KanbanView;
        }

        if (view && view instanceof KanbanView) {
          view.setView('board');
        }
      },
    });

    this.addCommand({
      id: 'view-table',
      name: t('View as table'),
      checkCallback: (checking) => {
        const view = app.workspace.getActiveViewOfType(KanbanView);

        if (checking) {
          return view && view instanceof KanbanView;
        }

        if (view && view instanceof KanbanView) {
          view.setView('table');
        }
      },
    });

    this.addCommand({
      id: 'view-list',
      name: t('View as list'),
      checkCallback: (checking) => {
        const view = app.workspace.getActiveViewOfType(KanbanView);

        if (checking) {
          return view && view instanceof KanbanView;
        }

        if (view && view instanceof KanbanView) {
          view.setView('list');
        }
      },
    });

    this.addCommand({
      id: 'open-board-settings',
      name: t('Open board settings'),
      checkCallback: (checking) => {
        const view = app.workspace.getActiveViewOfType(KanbanView);

        if (!view) return false;
        if (checking) return true;

        view.getBoardSettings();
      },
    });
  }

  registerMonkeyPatches() {
    const self = this;

    this.app.workspace.onLayoutReady(() => {
      this.register(
        around((app as any).commands, {
          executeCommand(next) {
            return function (command: any) {
              const view = app.workspace.getActiveViewOfType(KanbanView);

              if (view && command?.id) {
                view.emitter.emit('hotkey', { commandId: command.id });
              }

              return next.call(this, command);
            };
          },
        })
      );
    });

    this.register(
      around(this.app.workspace, {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        setActiveLeaf(next) {
          return function (...args) {
            next.apply(this, args);
            const view = this.getActiveViewOfType(KanbanView);
            if (view?.activeEditor) {
              this.activeEditor = view.activeEditor;
            }
          };
        },
      })
    );

    this.register(
      around(WorkspaceLeaf.prototype, {
        detach(next) {
          return function () {
            const state = this.view?.getState();

            if (state?.file && self.kanbanFileModes[this.id || state.file]) {
              delete self.kanbanFileModes[this.id || state.file];
            }

            return next.apply(this);
          };
        },

        setViewState(next) {
          return function (state: ViewState, ...rest: any[]) {
            const stateFile = state.state?.file as string | undefined;
            if (
              self._loaded &&
              state.type === 'markdown' &&
              stateFile &&
              self.kanbanFileModes[this.id || stateFile] !== 'markdown'
            ) {
              const cache = self.app.metadataCache.getCache(stateFile);

              if (cache?.frontmatter && cache.frontmatter[frontmatterKey]) {
                const newState = {
                  ...state,
                  type: kanbanViewType,
                };

                self.kanbanFileModes[stateFile] = kanbanViewType;

                return next.apply(this, [newState, ...rest]);
              }
            }

            return next.apply(this, [state, ...rest]);
          };
        },
      })
    );
  }
}
