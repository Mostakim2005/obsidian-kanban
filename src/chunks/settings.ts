import update from 'immutability-helper';

import type { KanbanView } from '../KanbanView';
import { SettingsManager, SettingsManagerConfig, SettingsModal } from '../Settings';
import type KanbanPlugin from '../main';

export function mountGlobalSettingsUI(
  plugin: KanbanPlugin,
  containerEl: HTMLElement,
  heading: string,
  config: SettingsManagerConfig
): SettingsManager {
  const manager = new SettingsManager(plugin, config, plugin.settings);
  manager.constructUI(containerEl, heading, false);
  return manager;
}

export function openBoardSettings(plugin: KanbanPlugin, view: KanbanView): void {
  const stateManager = plugin.stateManagers.get(view.file);
  if (!stateManager) return;
  const board = stateManager.state;

  new SettingsModal(
    view,
    {
      onSettingsChange: (settings) => {
        const updatedBoard = update(board, {
          data: {
            settings: {
              $set: settings,
            },
          },
        });
        stateManager.setState(updatedBoard);
      },
    },
    board.data.settings
  ).open();
}

export type KanbanSettingsChunk = {
  mountGlobalSettingsUI: typeof mountGlobalSettingsUI;
  openBoardSettings: typeof openBoardSettings;
};
