<script lang="ts">
	import { getConfig, updateConfig } from '$lib/api/settings.remote';
	import { signout } from '$lib/api/auth.remote';
	import { page } from '$app/state';
	import Icon from '@iconify/svelte';
	import { toast } from '$lib/toast';
	import { track } from '$lib/analytics/track';
	import { SETTINGS_SAVE, AUTH_SIGNOUT } from '$lib/analytics/events';

	const PROVIDER_MODELS: Record<string, { id: string; label: string; recommended?: boolean }[]> = {
		openai: [
			{ id: 'gpt-4.1', label: 'GPT-4.1', recommended: true },
			{ id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
			{ id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
			{ id: 'gpt-4o', label: 'GPT-4o' },
			{ id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
			{ id: 'o3', label: 'o3' },
			{ id: 'o3-mini', label: 'o3 Mini' },
			{ id: 'o4-mini', label: 'o4 Mini' },
		],
		groq: [
			{ id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', recommended: true },
			{ id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant' },
			{ id: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout 17B' },
			{ id: 'qwen/qwen3-32b', label: 'Qwen3 32B' },
		],
		openrouter: [
			{ id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', recommended: true },
			{ id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
			{ id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
			{ id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' },
			{ id: 'anthropic/claude-4.5-sonnet-20250929', label: 'Claude 4.5 Sonnet' },
			{ id: 'anthropic/claude-4-sonnet-20250522', label: 'Claude 4 Sonnet' },
			{ id: 'deepseek/deepseek-chat-v3.1', label: 'DeepSeek V3.1' },
			{ id: 'x-ai/grok-4-fast', label: 'Grok 4 Fast' },
			{ id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
			{ id: 'openai/gpt-4.1-mini-2025-04-14', label: 'GPT-4.1 Mini' },
		],
		ollama: [],
		bedrock: [],
	};

	function getModels(provider: string) {
		return PROVIDER_MODELS[provider] ?? [];
	}

	function getDefaultModel(provider: string) {
		const models = getModels(provider);
		return models.find((m) => m.recommended)?.id ?? models[0]?.id ?? '';
	}

	const initialConfig = await getConfig();
	let config = $state(initialConfig);
	const layoutData = page.data;

	// Compute initial values from the saved config (non-reactive, one-time)
	const initProvider = initialConfig?.provider ?? 'openai';
	const initModel = initialConfig?.model ?? '';
	const initModels = PROVIDER_MODELS[initProvider] ?? [];
	const initIsCustom = !!initModel && !initModels.some((m) => m.id === initModel);

	let selectedProvider = $state(initProvider);
	let customModel = $state(initIsCustom ? initModel : '');
	let useCustomModel = $state(initIsCustom);
	let selectedModel = $state(initModel || getDefaultModel(initProvider));

	function handleProviderChange(e: Event) {
		const provider = (e.target as HTMLSelectElement).value;
		selectedProvider = provider;
		useCustomModel = false;
		customModel = '';
		selectedModel = getDefaultModel(provider);
	}

	function handleModelChange(e: Event) {
		const value = (e.target as HTMLSelectElement).value;
		if (value === '__custom__') {
			useCustomModel = true;
			selectedModel = customModel;
		} else {
			useCustomModel = false;
			customModel = '';
			selectedModel = value;
		}
	}
</script>

<h2 class="mb-6 text-xl md:text-2xl font-bold">Settings</h2>

<!-- Account -->
<p class="mb-3 text-sm font-medium text-stone-500">Account</p>
<div class="mb-8 rounded-2xl bg-white">
	<div class="flex items-center justify-between px-4 md:px-6 py-4">
		<span class="text-sm text-stone-500">Email</span>
		<span class="text-sm font-medium text-stone-900 blur-sm transition-all duration-200 hover:blur-none">{layoutData.user.email}</span>
	</div>
	{#if layoutData.plan}
		<div class="flex items-center justify-between border-t border-stone-100 px-4 md:px-6 py-4">
			<span class="text-sm text-stone-500">Plan</span>
			<span class="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
				<Icon icon="solar:verified-check-bold-duotone" class="h-3.5 w-3.5" />
				{layoutData.plan === 'ltd' ? 'Lifetime' : layoutData.plan}
			</span>
		</div>
	{/if}
	{#if layoutData.licenseKey}
		<div class="flex items-center justify-between border-t border-stone-100 px-4 md:px-6 py-4">
			<span class="text-sm text-stone-500">License</span>
			<span class="font-mono text-sm text-stone-600">{layoutData.licenseKey}</span>
		</div>
	{/if}
</div>

<!-- LLM Provider -->
<p class="mb-3 text-sm font-medium text-stone-500">LLM Provider</p>
<div class="rounded-2xl bg-white p-6">
	<form
		{...updateConfig.enhance(async ({ submit }) => {
			await submit().updates(getConfig());
			config = await getConfig();
			toast.success('Settings saved');
			track(SETTINGS_SAVE);
		})}
		class="space-y-4"
	>
		<label class="block">
			<span class="text-sm text-stone-600">Provider</span>
			<select
				{...updateConfig.fields.provider.as('text')}
				onchange={handleProviderChange}
				class="mt-1 block w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
			>
				<option value="openai">OpenAI</option>
				<option value="groq">Groq</option>
				<option value="ollama">Ollama</option>
				<option value="bedrock">AWS Bedrock</option>
				<option value="openrouter">OpenRouter</option>
			</select>
			{#each updateConfig.fields.provider.issues() ?? [] as issue (issue.message)}
				<p class="text-sm text-red-600">{issue.message}</p>
			{/each}
		</label>

		<label class="block">
			<span class="text-sm text-stone-600">API Key</span>
			<input
				{...updateConfig.fields.apiKey.as('password')}
				placeholder={config?.apiKey ?? 'Enter your API key'}
				class="mt-1 block w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
			/>
			{#each updateConfig.fields.apiKey.issues() ?? [] as issue (issue.message)}
				<p class="text-sm text-red-600">{issue.message}</p>
			{/each}
		</label>

		<div class="block">
			<span class="text-sm text-stone-600">Model</span>
			{#if getModels(selectedProvider).length > 0}
				<select
					onchange={handleModelChange}
					value={useCustomModel ? '__custom__' : selectedModel}
					class="mt-1 block w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
				>
					{#each getModels(selectedProvider) as model}
						<option value={model.id}>
							{model.label}{model.recommended ? ' (Recommended)' : ''}
						</option>
					{/each}
					<option value="__custom__">Custom model ID...</option>
				</select>
				{#if useCustomModel}
					<input
						bind:value={customModel}
						oninput={() => (selectedModel = customModel)}
						placeholder="Enter model ID"
						class="mt-2 block w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
					/>
				{/if}
			{:else}
				<input
					bind:value={selectedModel}
					placeholder="Enter model ID"
					class="mt-1 block w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
				/>
			{/if}
			<input type="hidden" name="model" value={selectedModel} />
		</div>

		<button
			type="submit"
			class="flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
		>
			<Icon icon="solar:diskette-bold-duotone" class="h-4 w-4" />
			Save
		</button>
	</form>

	{#if config}
		<div class="mt-4 flex items-center gap-2 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-500">
			<Icon icon="solar:info-circle-bold-duotone" class="h-4 w-4 shrink-0 text-stone-400" />
			Current: {config.provider} &middot; Key: {config.apiKey}
			{#if config.model} &middot; Model: {config.model}{/if}
		</div>
	{/if}
</div>

<!-- Mobile sign out (sidebar hidden on mobile) -->
<div class="mt-8 md:hidden">
	<form {...signout}>
		<button
			type="submit"
			data-umami-event={AUTH_SIGNOUT}
			class="flex w-full items-center justify-center gap-2 rounded-lg border border-stone-200 px-4 py-2.5 text-sm text-stone-500 transition-colors hover:bg-stone-50 hover:text-stone-700"
		>
			<Icon icon="solar:logout-2-bold-duotone" class="h-4 w-4" />
			Sign out
		</button>
	</form>
</div>
