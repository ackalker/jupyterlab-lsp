import {
  IAdapterRegistration,
  IAdapterTypeOptions,
  ILSPAdapterManager,
  PLUGIN_ID
} from './tokens';
import { Signal } from '@lumino/signaling';
import { IDocumentWidget } from '@jupyterlab/docregistry';
import { WidgetAdapter } from './adapters/adapter';
import { ILabShell, JupyterFrontEndPlugin } from '@jupyterlab/application';
import { LSPExtension } from './index';

export class WidgetAdapterManager implements ILSPAdapterManager {
  adapterTypeAdded: Signal<
    WidgetAdapterManager,
    IAdapterTypeOptions<IDocumentWidget>
  >;
  adapterChanged: Signal<WidgetAdapterManager, WidgetAdapter<IDocumentWidget>>;
  adapterDisposed: Signal<WidgetAdapterManager, WidgetAdapter<IDocumentWidget>>;
  currentAdapter: WidgetAdapter<IDocumentWidget>;

  protected adapters: Map<string, WidgetAdapter<IDocumentWidget>> = new Map();
  protected adapterTypes: IAdapterTypeOptions<IDocumentWidget>[];

  get types(): IAdapterTypeOptions<IDocumentWidget>[] {
    return this.adapterTypes;
  }

  constructor(protected labShell: ILabShell) {
    this.adapterChanged = new Signal(this);
    this.adapterDisposed = new Signal(this);
    this.adapterTypeAdded = new Signal(this);
    this.adapterTypes = [];
    labShell.currentChanged.connect(this.onLabFocusChanged, this);
  }

  public registerAdapterType(options: IAdapterTypeOptions<IDocumentWidget>) {
    this.adapterTypes.push(options);
    this.adapterTypeAdded.emit(options);
  }

  private connect(
    extension: LSPExtension,
    type: IAdapterTypeOptions<IDocumentWidget>
  ) {
    type.tracker.widgetAdded.connect((tracker, widget) => {
      this.connectWidget(extension, widget, type);
    });
  }

  public registerExtension(extension: LSPExtension) {
    for (let type of this.adapterTypes) {
      this.connect(extension, type);
    }
    this.adapterTypeAdded.connect((manager, type) => {
      this.connect(extension, type);
    });
  }

  protected connectWidget(
    extension: LSPExtension,
    widget: IDocumentWidget,
    type: IAdapterTypeOptions<IDocumentWidget>
  ) {
    let adapter = new type.adapter(extension, widget);
    this.registerAdapter({
      adapter: adapter,
      id: type.get_id(widget),
      re_connector: () => {
        this.connectWidget(extension, widget, type);
      }
    });
  }

  protected onLabFocusChanged() {
    const current = this.labShell.currentWidget as IDocumentWidget;
    if (!current) {
      return;
    }
    let adapter = null;

    for (let type of this.adapterTypes) {
      if (type.tracker.has(current)) {
        let id = type.get_id(current);
        adapter = this.adapters.get(id);
      }
    }

    if (adapter != null) {
      this.adapterChanged.emit(adapter);
      this.currentAdapter = adapter;
    }
  }

  protected registerAdapter(options: IAdapterRegistration) {
    let { id, adapter, re_connector } = options;
    let widget = options.adapter.widget;

    if (this.adapters.has(id)) {
      let old = this.adapters.get(id);
      console.warn(
        `Adapter with id ${id} was already registered (${adapter} vs ${old}) `
      );
    }
    this.adapters.set(id, adapter);

    const disconnect = () => {
      this.adapters.delete(id);
      widget.disposed.disconnect(disconnect);
      widget.context.pathChanged.disconnect(reconnect);
      adapter.dispose();
    };

    const reconnect = () => {
      disconnect();
      re_connector();
    };

    widget.disposed.connect(() => {
      disconnect();
      this.adapterDisposed.emit(adapter);
    });
    widget.context.pathChanged.connect(reconnect);

    // TODO: maybe emit adapterCreated. Should it be handled by statusbar?
  }

  isAnyActive() {
    return (
      this.labShell.currentWidget &&
      this.adapterTypes.some(type => type.tracker.currentWidget) &&
      this.adapterTypes.some(
        type => type.tracker.currentWidget == this.labShell.currentWidget
      )
    );
  }
}

export const WIDGET_ADAPTER_MANAGER: JupyterFrontEndPlugin<ILSPAdapterManager> = {
  id: PLUGIN_ID + ':ILSPAdapterManager',
  requires: [ILabShell],
  activate: (app, labShell: ILabShell) => {
    return new WidgetAdapterManager(labShell);
  },
  provides: ILSPAdapterManager,
  autoStart: true
};
