<script lang="ts">
	import { listDevices } from '$lib/api/devices.remote';

	const devices = await listDevices();
</script>

<h2 class="mb-6 text-2xl font-bold">Devices</h2>

{#if devices.length === 0}
	<div class="rounded-lg border border-neutral-200 p-8 text-center">
		<p class="text-neutral-500">No devices connected.</p>
		<p class="mt-2 text-sm text-neutral-400">
			Install the Android app, paste your API key, and your device will appear here.
		</p>
		<a href="/dashboard/api-keys" class="mt-4 inline-block text-sm text-blue-600 hover:underline">
			Create an API key
		</a>
	</div>
{:else}
	<div class="space-y-3">
		{#each devices as device (device.deviceId)}
			<a
				href="/dashboard/devices/{device.deviceId}"
				class="flex items-center justify-between rounded-lg border border-neutral-200 p-4 hover:border-neutral-400"
			>
				<div>
					<p class="font-medium">{device.name}</p>
					<p class="text-sm text-neutral-500">
						Connected {new Date(device.connectedAt).toLocaleString()}
					</p>
				</div>
				<span class="inline-block h-2 w-2 rounded-full bg-green-500"></span>
			</a>
		{/each}
	</div>
{/if}
