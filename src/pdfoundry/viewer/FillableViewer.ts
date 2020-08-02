import BaseViewer from './BaseViewer';
import Settings from '../settings/Settings';
import { PDFData } from '../common/types/PDFData';

export default class FillableViewer extends BaseViewer {
    // <editor-fold desc="Static Properties">

    static get defaultOptions() {
        const options = super.defaultOptions;
        options.template = `systems/${Settings.EXTERNAL_SYSTEM_NAME}/pdfoundry-dist/templates/app/pdf-viewer-fillable.html`;
        return options;
    }

    // </editor-fold>
    // <editor-fold desc="Static Methods">

    /**
     * Validate the data path of the key.
     * @param path
     */
    protected static dataPathValid(path: string): boolean {
        return !path.includes('_id');
    }

    /**
     * Fix keys by removing invalid characters
     * @param key
     */
    protected static fixKey(key: string): string {
        if (key.startsWith(`data.`)) {
            return key;
        }

        key = key.trim();
        return key.replace(/\s/g, '_');
    }

    /**
     * Resolve a key path to the proper flattened key
     * @param key
     */
    protected static resolveKeyPath(key: string): string {
        if (key === 'name') return key;
        if (key.startsWith(`data.`)) {
            return this.fixKey(key);
        }
        return `flags.${Settings.EXTERNAL_SYSTEM_NAME}.${Settings.ACTOR_DATA_KEY}.${this.fixKey(key)}`;
    }

    // </editor-fold>
    // <editor-fold desc="Properties">

    protected entity: Entity;
    protected pdfData: PDFData;
    private container: JQuery;

    // </editor-fold>
    // <editor-fold desc="Constructor & Initialization">

    public constructor(entity: Item | Actor, pdfData: PDFData, options?: ApplicationOptions) {
        super(options);

        this.entity = entity;
        this.pdfData = pdfData;

        this.bindHooks();
    }

    // </editor-fold>
    // <editor-fold desc="Getters & Setters">

    public get entityType(): 'Actor' | 'Item' {
        return this.entity.data.type as 'Actor' | 'Item';
    }

    protected flattenEntity(): Record<string, string> {
        const data = flattenObject({
            name: this.entity.name,
            data: this.entity.data.data,
            flags: this.entity.data.flags,
        }) as Record<string, string>;

        // Do not allow non-data keys to make it into the flat object
        for (const key of Object.keys(data)) {
            if (!FillableViewer.dataPathValid(key)) {
                delete data[key];
            }
        }

        return data;
    }

    // </editor-fold>
    // <editor-fold desc="Instance Methods">

    protected bindHooks(): void {
        switch (this.entityType) {
            case 'Actor':
                Hooks.on('updateActor', this.onUpdateEntity.bind(this));
                break;
            case 'Item':
                Hooks.on('updateItem', this.onUpdateEntity.bind(this));
                break;
        }
    }

    protected unbindHooks(): void {
        switch (this.entityType) {
            case 'Actor':
                Hooks.off('updateActor', this.onUpdateEntity.bind(this));
                break;
            case 'Item':
                Hooks.off('updateItem', this.onUpdateEntity.bind(this));
                break;
        }
    }

    protected elementIsCheckbox(element: HTMLElement): element is HTMLInputElement {
        return element.tagName === 'INPUT' && element.getAttribute('type') === 'checkbox';
    }

    protected elementIsInput(element: HTMLElement): element is HTMLInputElement | HTMLTextAreaElement {
        return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA';
    }

    protected onPageRendered(event) {
        const container = $(event.source.div);
        const elements = container.find('input, textarea') as JQuery<HTMLInputElement | HTMLTextAreaElement>;

        if (this.container === undefined || this.container.length === 0) {
            this.container = $(container.parents().find('#viewerContainer'));
        }

        this.initializeInputs(elements);

        elements.on('change', this.onInputChanged.bind(this));

        super.onPageRendered(event);
    }

    protected onInputChanged(event) {
        const element = event.currentTarget;
        let value = '';

        let key = $(element).attr('name');
        if (key === undefined) {
            return;
        }

        key = FillableViewer.resolveKeyPath(key);

        if (!FillableViewer.dataPathValid(key)) {
            return;
        }

        if (this.elementIsCheckbox(element)) {
            value = this.getCheckInputValue($(element));
        } else if (this.elementIsInput(element)) {
            value = this.getTextInputValue($(element as HTMLInputElement | HTMLTextAreaElement));
        }

        this.update(
            this.resolveDelta(this.flattenEntity(), {
                [key]: value,
            }),
        );
    }

    protected initializeInputs(elements: JQuery) {
        const oldData = this.flattenEntity();
        const newData = duplicate(oldData);

        // Load data from sheet as initialization data
        // Fill in existing data where it exists on the actor
        let write = false;
        for (const element of elements) {
            let key = element.getAttribute('name');
            if (key === null || !FillableViewer.dataPathValid(key)) {
                continue;
            }

            key = FillableViewer.resolveKeyPath(key);

            if (this.elementIsCheckbox(element)) {
                write = this.initializeCheckInput($(element), key, newData) || write;
            } else if (this.elementIsInput(element)) {
                write = this.initializeTextInput($(element), key, newData) || write;
            } else {
                console.error('Unsupported input type in PDF.');
            }
        }

        if (write) {
            this.update(this.resolveDelta(oldData, newData));
        }
    }

    protected resolveDelta(oldData: Record<string, any>, newData: Record<string, any>) {
        // Flags must be fully resolved
        const delta = { ...flattenObject({ flags: this.entity.data.flags }) };
        for (const [key, newValue] of Object.entries(newData)) {
            const oldValue = oldData[key];

            // Arrays dont make sense on PDFs which are not dynamic
            if (Array.isArray(newValue) || Array.isArray(oldValue)) {
                delete delta[key];
                continue;
            }

            // Skip matching values
            if (oldValue !== undefined && newValue === oldValue) {
                continue;
            }

            delta[key] = newValue;
        }

        return delta;
    }

    public refreshTitle(): void {
        $(this.element).parent().parent().find('.window-title').text(this.title);
    }

    protected onUpdateEntity(actor: Actor, data: Partial<ActorData> & { _id: string }, options: { diff: boolean }, id: string) {
        if (data._id !== this.entity.id) {
            return;
        }

        const args = duplicate(data);
        delete args['_id'];

        const elementsToUpdate = this.container.find('input, textarea');
        this.initializeInputs(elementsToUpdate);
        this.refreshTitle();
    }

    protected async update(delta: object) {
        // data must be expanded to set properly
        return this.entity.update(expandObject(delta));
    }

    protected initializeTextInput(input: JQuery<HTMLInputElement | HTMLTextAreaElement>, key: string, data: Record<string, string>): boolean {
        let value = data[key];
        if (value === undefined) {
            // If value does not exist on actor yet, load from sheet
            const inputValue = input.val();

            if (inputValue) {
                // Actor changes were made
                data[key] = inputValue.toString();
                return true;
            }
        } else {
            // Otherwise initialize input value to actor value
            this.setTextInput(input, value);
        }
        return false;
    }

    protected initializeCheckInput(input: JQuery<HTMLInputElement>, key: string, data: Record<string, string>): boolean {
        let value = data[key];
        if (value === undefined) {
            const inputValue = input.attr('checked') !== undefined;

            // Actor changes were made
            data[key] = inputValue.toString();
            return true;
        } else {
            this.setCheckInput(input, value);
        }
        return false;
    }

    protected setTextInput(input: JQuery<HTMLInputElement | HTMLTextAreaElement>, value: string) {
        input.val(value);
    }

    protected setCheckInput(input: JQuery<HTMLInputElement>, value: string) {
        if (value === 'true') {
            input.attr('checked', 'true');
        } else {
            input.removeAttr('checked');
        }
    }

    protected getTextInputValue(input: JQuery<HTMLInputElement | HTMLTextAreaElement>): string {
        const value = input.val();
        if (!value) {
            return '';
        }

        return value.toString().trim();
    }

    protected getCheckInputValue(input: JQuery<HTMLInputElement>): string {
        return (window.getComputedStyle(input.get(0), ':before').content !== 'none').toString();
    }

    async close(): Promise<any> {
        // await this.setActorData(this.actorData);
        if (this._viewer) {
            await this._viewer.close();
        }

        this.unbindHooks();

        return super.close();
    }

    // </editor-fold>
}