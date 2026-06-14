import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry, IWorkbenchContribution } from '../../../common/contributions.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IChatAgentService } from '../../chat/common/participants/chatAgents.js';
import { ILanguageModelsService } from '../../chat/common/languageModels.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ChatAgentLocation, ChatModeKind } from '../../chat/common/constants.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Emitter } from '../../../../base/common/event.js';
import { ILanguageModelsConfigurationService } from '../../chat/common/languageModelsConfiguration.js';

class BlackChatNativeContribution extends Disposable implements IWorkbenchContribution {
	private registeredModels: DisposableStore;

	constructor(
		@IChatAgentService private readonly chatAgentService: IChatAgentService,
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILanguageModelsConfigurationService private readonly languageModelsConfigurationService: ILanguageModelsConfigurationService
	) {
		super();
		this.registeredModels = this._register(new DisposableStore());
		this.registerBlackChatAgent();
		this.registerBlackModels();

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('blackChat.models')) {
				this.registerBlackModels();
			}
		}));
	}

	private registerBlackChatAgent() {
		const agent = this.chatAgentService.registerAgent(
			'Black.blackChat',
			{
				name: 'Black',
				description: 'Black AI Assistant',
				extensionId: { value: 'Black.blackChat' } as any,
				publisherDisplayName: 'Black',
				extensionPublisherId: 'Black',
				extensionDisplayName: 'Black Chat',
				id: 'Black.blackChat',
				isDefault: true,
				metadata: {
					themeIcon: ThemeIcon.fromId('sparkle')
				},
				slashCommands: [],
				extensionVersion: '1.0.0',
				locations: [ChatAgentLocation.Chat],
				modes: [ChatModeKind.Agent, ChatModeKind.Ask],
				disambiguation: []
			}
		);

		this._register(agent);

		// Now register the handler
		const agentRegistration = this.chatAgentService.registerAgentImplementation(
			'Black.blackChat',
			{
				invoke: async (request, progress, history, token: CancellationToken) => {
					progress([{ kind: 'progressMessage', content: { value: 'Sending to Black Sidecar...' } }] as any);
					
					try {
						// Simple HTTP call to sidecar
						let modelId = 'Auto'; // We ignore model selection for now to avoid errors
						let apiBase = '';
						let apiKey = '';

						const selectedModelId = request.userSelectedModelId;
						if (selectedModelId) {
							const selectedModel = this.languageModelsService.lookupLanguageModel(selectedModelId);
							if (selectedModel) {
								const groups = this.languageModelsConfigurationService.getLanguageModelsProviderGroups();
								const group = groups.find(g => g.name === selectedModel.vendor || g.vendor === selectedModel.vendor);
								if (group) {
									apiBase = group.url as string || '';
									apiKey = group.apiKey as string || '';
								}
								modelId = selectedModel.name || selectedModel.id;
							}
						}

						const response = await fetch('http://127.0.0.1:5000/api/chat', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({
								text: request.message,
								model: modelId,
								api_base: apiBase,
								api_key: apiKey
							})
						});
						
						if (response.body) {
							const reader = response.body.getReader();
							const decoder = new TextDecoder();
							let done = false;
							while (!done) {
								if (token.isCancellationRequested) {
									break;
								}
								const { value, done: readerDone } = await reader.read();
								if (value) {
									const chunk = decoder.decode(value, { stream: !readerDone });
									progress([{ kind: 'markdownContent', content: { value: chunk } }] as any);
								}
								done = readerDone;
							}
						}
					} catch (e: any) {
						progress([{ kind: 'markdownContent', content: { value: `**Error:** ${e.message}` } }] as any);
					}
					
					return { timings: { firstProgress: 0, totalElapsed: 0 } };
				},
				provideFollowups: async () => []
			}
		);

		this._register(agentRegistration);
	}

	private registerBlackModels() {
		let models = this.configurationService.getValue<any[]>('blackChat.models');
		if (!models || !Array.isArray(models)) {
			models = [];
		}

		this.registeredModels.clear();

		try {
			const lmService = this.languageModelsService as any;
			const vendorsToRegister = ['Black', 'customendpoint', 'customoai'];
			
			for (const registeredVendor of vendorsToRegister) {
				const provider = {
					identifier: `black-models-provider-${registeredVendor}`,
					onDidChange: new Emitter<void>().event,
					provideLanguageModelChatInfo: async (options: any) => {
						const groupName = options?.group || registeredVendor;
						
						// Handle dynamically added models from the UI
						let resolvedModels: any[] = [];
						if (options?.configuration?.models && Array.isArray(options.configuration.models)) {
							resolvedModels = options.configuration.models.map((m: string) => ({ id: m, name: m }));
						} else if (registeredVendor === 'Black') {
							resolvedModels = this.configurationService.getValue<any[]>('blackChat.models') || [];
						} else {
							// Return empty models for custom vendors if no config is provided
							return [];
						}
						
						return resolvedModels.map((m: any) => ({
							identifier: `${groupName}/${m.id}`,
							metadata: {
								extension: { value: 'Black.blackChat' },
								id: m.id,
								vendor: groupName,
								family: groupName,
								version: '1.0',
								name: m.name || m.id,
								maxInputTokens: 100000,
								maxOutputTokens: 4096,
								isDefaultForLocation: { 'panel': true, 'terminal': true, 'notebook': true, 'editor': true },
								capabilities: {
									toolCalling: true
								}
							}
						}));
					},
					provideLanguageModelResponse: async () => { throw new Error('Use Agent instead'); },
					sendChatRequest: async () => { throw new Error('Use Agent instead'); },
					provideTokenCount: async () => 0
				};

				if (lmService.registerLanguageModelChatProvider) {
					this.registeredModels.add(lmService.registerLanguageModelChatProvider(registeredVendor, provider));
				} else if (lmService.registerLanguageModelProvider) {
					this.registeredModels.add(lmService.registerLanguageModelProvider(registeredVendor, provider));
				}
			}

			for (const m of models) {
				const metadata = {
					extension: { value: 'Black.blackChat' },
					id: m.id,
					vendor: 'Black',
					family: 'Black',
					version: '1.0',
					name: m.name,
					maxInputTokens: 100000,
					isDefaultForLocation: { 'panel': true, 'terminal': true, 'notebook': true, 'editor': true },
					capabilities: { toolCalling: true }
				};
				if (lmService.registerLanguageModelChat) {
					this.registeredModels.add(lmService.registerLanguageModelChat(metadata));
				} else if (lmService.registerLanguageModel) {
					this.registeredModels.add(lmService.registerLanguageModel(metadata));
				}
			}
		} catch (e) {
			console.error("Failed to register models", e);
		}
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(BlackChatNativeContribution, LifecyclePhase.Restored);

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'blackChat',
	order: 1,
	title: 'Black Chat',
	type: 'object',
	properties: {
		'blackChat.models': {
			type: 'array',
			description: 'List of flexible AI models for Black IDE',
			items: {
				type: 'object',
				properties: {
					id: { type: 'string', description: 'Model ID (e.g. gpt-4o, llama3)' },
					name: { type: 'string', description: 'Display name' },
					endpoint: { type: 'string', description: 'API endpoint URL' },
					apiKey: { type: 'string', description: 'API key' },
				}
			},
			default: []
		}
	}
});
