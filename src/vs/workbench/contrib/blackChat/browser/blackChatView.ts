import * as dom from '../../../../base/browser/dom.js';
import { ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IViewletViewOptions } from '../../../browser/parts/views/viewsViewlet.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { InputBox } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { SelectBox } from '../../../../base/browser/ui/selectBox/selectBox.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { defaultInputBoxStyles, defaultSelectBoxStyles, defaultButtonStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import './blackChat.css';

export class BlackChatViewPane extends ViewPane {

	private messagesContainer!: HTMLElement;
	private inputBox!: InputBox;
	private modeSelect!: SelectBox;
	private modelSelect!: SelectBox;
	private socket?: WebSocket;
	private selectedModeIndex: number = 0;
	private selectedModelIndex: number = 0;

	constructor(
		options: IViewletViewOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IContextViewService private readonly contextViewService: IContextViewService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		const wrapper = dom.append(container, dom.$('.black-chat-wrapper'));

		// Header (Selectors)
		const header = dom.append(wrapper, dom.$('.black-chat-header'));
		
		// Mode Selector
		this.modeSelect = this._register(new SelectBox([
			{ text: 'Builder' },
			{ text: 'Planner' }
		], 0, this.contextViewService, defaultSelectBoxStyles, { ariaLabel: 'Agent Mode' }));
		
		this._register(this.modeSelect.onDidSelect(e => {
			this.selectedModeIndex = e.index;
		}));

		this.modeSelect.render(dom.append(header, dom.$('.black-chat-mode-select')));

		// Model Selector
		const modelSelectContainer = dom.append(header, dom.$('.black-chat-model-select'));
		this.modelSelect = this._register(new SelectBox([
			{ text: 'Claude 3.5 Sonnet' },
			{ text: 'GPT-4o' },
			{ text: 'Gemini 1.5 Pro' },
			{ text: 'Perplexity Llama' },
			{ text: 'Ollama (Local)' }
		], 0, this.contextViewService, defaultSelectBoxStyles, { ariaLabel: 'AI Model' }));

		this._register(this.modelSelect.onDidSelect(e => {
			this.selectedModelIndex = e.index;
		}));
		
		this.modelSelect.render(modelSelectContainer);

		// Messages Area
		this.messagesContainer = dom.append(wrapper, dom.$('.black-chat-messages'));

		// Input Area
		const inputContainer = dom.append(wrapper, dom.$('.black-chat-input-container'));
		this.inputBox = this._register(new InputBox(inputContainer, this.contextViewService, {
			placeholder: 'Message Black...',
			inputBoxStyles: defaultInputBoxStyles
		}));

		const sendButtonContainer = dom.append(inputContainer, dom.$('.black-chat-send-container'));
		const sendButton = this._register(new Button(sendButtonContainer, defaultButtonStyles));
		sendButton.label = 'Send';
		this._register(sendButton.onDidClick(() => this.sendMessage()));

		this._register(this.inputBox.onDidChange(value => {
			if (value.endsWith('\n')) {
				// Prevent newline in simple input box, instead send message
				this.inputBox.value = value.trim();
				this.sendMessage();
			}
		}));

		this.connectWebSocket();
	}

	private connectWebSocket() {
		this.appendMessage('System', 'Connecting to Black AI brain...');
		
		try {
			this.socket = new WebSocket('ws://localhost:5000/ws');
			
			this.socket.onopen = () => {
				this.appendMessage('System', 'Connected.');
			};

			this.socket.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data);
					if (data.type === 'token') {
						// Stream token
						this.appendMessageToken(data.content);
					} else if (data.type === 'message') {
						this.appendMessage('Black', data.content);
					}
				} catch (e) {
					this.appendMessage('Black', event.data);
				}
			};

			this.socket.onerror = (err) => {
				this.appendMessage('System', 'WebSocket Error. Make sure server.py is running.');
			};

			this.socket.onclose = () => {
				this.appendMessage('System', 'Disconnected. Reconnecting in 5s...');
				setTimeout(() => this.connectWebSocket(), 5000);
			};
		} catch (err) {
			this.appendMessage('System', 'Failed to connect.');
		}
	}

	private currentStreamingMessageNode?: HTMLElement;

	private appendMessageToken(token: string) {
		if (!this.currentStreamingMessageNode) {
			const msgRow = dom.append(this.messagesContainer, dom.$('.black-chat-message.black'));
			const header = dom.append(msgRow, dom.$('.black-chat-message-header'));
			header.textContent = 'Black';
			this.currentStreamingMessageNode = dom.append(msgRow, dom.$('.black-chat-message-content'));
		}
		const txt = document.createTextNode(token);
		this.currentStreamingMessageNode.appendChild(txt);
		this.scrollToBottom();
	}

	private appendMessage(sender: string, text: string) {
		this.currentStreamingMessageNode = undefined; // reset streaming state
		const msgRow = dom.append(this.messagesContainer, dom.$('.black-chat-message.' + sender.toLowerCase()));
		const header = dom.append(msgRow, dom.$('.black-chat-message-header'));
		header.textContent = sender;
		const content = dom.append(msgRow, dom.$('.black-chat-message-content'));
		content.textContent = text;
		this.scrollToBottom();
	}

	private scrollToBottom() {
		this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
	}

	private sendMessage() {
		const text = this.inputBox.value;
		if (!text.trim()) { return; }

		this.appendMessage('User', text);
		this.inputBox.value = '';

		if (this.socket && this.socket.readyState === WebSocket.OPEN) {
			const models = ['claude-sonnet-4-20250514', 'gpt-4o', 'gemini-1.5-pro', 'perplexity-llama', 'ollama-local'];
			this.socket.send(JSON.stringify({
				type: 'chat',
				mode: this.selectedModeIndex === 0 ? 'builder' : 'planner',
				model: models[this.selectedModelIndex] || models[0],
				content: text
			}));
		} else {
			this.appendMessage('System', 'Cannot send: Not connected to brain.');
		}
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.messagesContainer.style.height = `${height - 100}px`; // Approx calc
	}
}
