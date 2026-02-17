import { object, string, pipe, minLength } from 'valibot';

export const createKeySchema = object({
	name: pipe(string(), minLength(1))
});

export const deleteKeySchema = object({
	keyId: pipe(string(), minLength(1))
});
