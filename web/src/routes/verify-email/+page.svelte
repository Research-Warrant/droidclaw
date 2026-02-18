<script lang="ts">
	import Icon from '@iconify/svelte';
</script>

<div class="flex min-h-screen items-center justify-center bg-neutral-50">
	<div class="w-full max-w-sm text-center">
		<div
			class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-900"
		>
			<Icon icon="ph:envelope-duotone" class="h-6 w-6 text-white" />
		</div>
		<h1 class="text-2xl font-bold">Check your email</h1>
		<p class="mt-2 text-sm text-neutral-500">
			We sent a verification link to your email address. Click the link to verify your account.
		</p>
		<p class="mt-4 text-sm text-neutral-400">
			Didn't receive it? Check your spam folder or
			<a href="/signup" class="font-medium text-neutral-700 hover:text-neutral-900">
				try signing up again</a
			>.
		</p>
		<a
			href="/login"
			class="mt-6 inline-flex items-center gap-2 text-sm font-medium text-neutral-700 hover:text-neutral-900"
		>
			<Icon icon="ph:arrow-left" class="h-4 w-4" />
			Back to login
		</a>
	</div>
</div>
