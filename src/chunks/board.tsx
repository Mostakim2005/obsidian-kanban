import { render, unmountComponentAtNode, useEffect, useState } from 'preact/compat';

import { createApp } from '../DragDropApp';
import type { KanbanView } from '../KanbanView';
import { StateManager } from '../StateManager';
import { DateSuggest, TimeSuggest } from '../components/Editor/suggest';
import { Kanban } from '../components/Kanban';
import { BasicMarkdownRenderer } from '../components/MarkdownRenderer/MarkdownRenderer';
import { Board } from '../components/types';
import { gotoNextDailyNote, gotoPrevDailyNote } from '../helpers';
import { bindMarkdownEvents } from '../helpers/renderMarkdown';
import { PromiseQueue } from '../helpers/util';
import type KanbanPlugin from '../main';

interface WindowRegistry {
  viewMap: Map<string, KanbanView>;
  viewStateReceivers: Array<(views: KanbanView[]) => void>;
  appRoot: HTMLElement;
}

function resolveEditorClass(app: any) {
  const md = app.embedRegistry.embedByExtension.md(
    { app: app, containerEl: createDiv(), state: {} },
    null,
    ''
  );

  md.load();
  md.editable = true;
  md.showEditor();

  const MarkdownEditor = Object.getPrototypeOf(Object.getPrototypeOf(md.editMode)).constructor;

  md.unload();

  return MarkdownEditor;
}

export function createBoardRuntime(plugin: KanbanPlugin) {
  const windowRegistry = new Map<Window, WindowRegistry>();
  let cachedMarkdownEditor: any = null;
  let suggestsRegistered = false;

  const ensureSuggests = () => {
    if (suggestsRegistered) return;
    suggestsRegistered = true;
    plugin.registerEditorSuggest(new TimeSuggest(plugin.app, plugin));
    plugin.registerEditorSuggest(new DateSuggest(plugin.app, plugin));
  };

  const getKanbanViews = (win: Window): KanbanView[] => {
    const reg = windowRegistry.get(win);
    return reg ? Array.from(reg.viewMap.values()) : [];
  };

  const getKanbanView = (id: string, win: Window): KanbanView | null => {
    const reg = windowRegistry.get(win);
    if (reg?.viewMap.has(id)) return reg.viewMap.get(id);
    for (const r of windowRegistry.values()) {
      if (r.viewMap.has(id)) return r.viewMap.get(id);
    }
    return null;
  };

  const mount = (win: Window) => {
    if (windowRegistry.has(win)) return;
    const el = win.document.body.createDiv();
    windowRegistry.set(win, {
      viewMap: new Map(),
      viewStateReceivers: [],
      appRoot: el,
    });
    render(createApp(win, plugin), el);
  };

  const removeView = (view: KanbanView) => {
    const entry = Array.from(windowRegistry.entries()).find(([, reg]) =>
      reg.viewMap.has(view.id)
    );
    if (!entry) return;
    const [win, reg] = entry;
    const file = view.file;
    if (reg.viewMap.has(view.id)) {
      reg.viewMap.delete(view.id);
    }
    if (plugin.stateManagers.has(file)) {
      plugin.stateManagers.get(file).unregisterView(view);
      reg.viewStateReceivers.forEach((fn) => fn(getKanbanViews(win)));
    }
  };

  const unmount = (win: Window) => {
    if (!windowRegistry.has(win)) return;
    const reg = windowRegistry.get(win);
    for (const view of reg.viewMap.values()) {
      removeView(view);
    }
    unmountComponentAtNode(reg.appRoot);
    reg.appRoot.remove();
    reg.viewMap.clear();
    reg.viewStateReceivers.length = 0;
    reg.appRoot = null;
    windowRegistry.delete(win);
  };

  const addView = (view: KanbanView, data: string, shouldParseData: boolean) => {
    ensureSuggests();
    const win = view.getWindow();
    if (!windowRegistry.has(win)) {
      mount(win);
    }
    const reg = windowRegistry.get(win);
    if (!reg) return;
    if (!reg.viewMap.has(view.id)) {
      reg.viewMap.set(view.id, view);
    }

    const file = view.file;
    if (plugin.stateManagers.has(file)) {
      plugin.stateManagers.get(file).registerView(view, data, shouldParseData);
    } else {
      plugin.stateManagers.set(
        file,
        new StateManager(
          plugin.app,
          view,
          data,
          () => plugin.stateManagers.delete(file),
          () => plugin.settings
        )
      );
    }
    reg.viewStateReceivers.forEach((fn) => fn(getKanbanViews(win)));
  };

  const handleViewFileRename = (view: KanbanView, oldPath: string) => {
    const win = view.getWindow();
    if (!windowRegistry.has(win)) return;
    const reg = windowRegistry.get(win);
    const oldId = `${(view.leaf as any).id}:::${oldPath}`;
    if (reg.viewMap.has(oldId)) reg.viewMap.delete(oldId);
    if (!reg.viewMap.has(view.id)) reg.viewMap.set(view.id, view);
    if (view.isPrimary) {
      plugin.getStateManager(view.file).softRefresh();
    }
  };

  const useKanbanViews = (win: Window): KanbanView[] => {
    const [state, setState] = useState(getKanbanViews(win));
    useEffect(() => {
      const reg = windowRegistry.get(win);
      reg?.viewStateReceivers.push(setState);
      setState(getKanbanViews(win));
      return () => {
        reg?.viewStateReceivers.remove(setState);
      };
    }, [win]);
    return state;
  };

  const bindView = (view: KanbanView) => {
    if (view._boardBound) return;
    view._boardBound = true;
    view.previewQueue = new PromiseQueue(() => view.emitter.emit('queueEmpty'));
    view.emitter.on('hotkey', ({ commandId }: { commandId: string }) => {
      switch (commandId) {
        case 'daily-notes:goto-prev':
          gotoPrevDailyNote(view.app, view.file);
          break;
        case 'daily-notes:goto-next':
          gotoNextDailyNote(view.app, view.file);
          break;
      }
    });
    bindMarkdownEvents(view);
  };

  const prerenderView = async (view: KanbanView, board: Board) => {
    bindView(view);
    board.children.forEach((lane) => {
      lane.children.forEach((item) => {
        if (view.previewCache.has(item.id)) return;
        view.previewQueue.add(async () => {
          const preview = view.addChild(new BasicMarkdownRenderer(view, item.data.title));
          view.previewCache.set(item.id, preview);
          await preview.renderCapability.promise;
        });
      });
    });
    if (view.previewQueue.isRunning) {
      await new Promise((res) => {
        view.emitter.once('queueEmpty', res);
      });
    }
  };

  const validatePreviewCache = (view: KanbanView, board: Board) => {
    const seenKeys = new Set<string>();
    board.children.forEach((lane) => {
      seenKeys.add(lane.id);
      lane.children.forEach((item) => {
        seenKeys.add(item.id);
      });
    });
    for (const k of view.previewCache.keys()) {
      if (!seenKeys.has(k)) {
        view.removeChild(view.previewCache.get(k));
        view.previewCache.delete(k);
      }
    }
  };

  const getPortal = (view: KanbanView) => {
    const stateManager = plugin.stateManagers.get(view.file);
    return <Kanban stateManager={stateManager} view={view} />;
  };

  const getMarkdownEditor = () => {
    if (!cachedMarkdownEditor) {
      cachedMarkdownEditor = resolveEditorClass(plugin.app);
    }
    return cachedMarkdownEditor;
  };

  const destroy = () => {
    cachedMarkdownEditor = null;
    windowRegistry.forEach((reg, win) => {
      reg.viewStateReceivers.forEach((fn) => fn([]));
      unmount(win);
    });
    unmount(window);
    windowRegistry.clear();
  };

  ensureSuggests();

  return {
    addView,
    removeView,
    handleViewFileRename,
    getKanbanViews,
    getKanbanView,
    useKanbanViews,
    mount,
    unmount,
    bindView,
    prerenderView,
    validatePreviewCache,
    getPortal,
    getMarkdownEditor,
    destroy,
  };
}

export type BoardRuntime = ReturnType<typeof createBoardRuntime>;
export type KanbanBoardChunk = {
  createBoardRuntime: typeof createBoardRuntime;
};
