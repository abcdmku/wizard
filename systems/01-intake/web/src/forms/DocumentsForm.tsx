import { useForm } from '@tanstack/react-form'
import { useState } from 'react'
import type { z } from 'zod'

import { DocumentMetadataSchema, DocumentsInputSchema } from '../../../shared/forms'
import { Alert, Button, Card, InputField, SectionHeader } from '../components'
import {
  type AsyncFormProps,
  FormActions,
  SelectControl,
  type SelectOption,
  TextControl,
} from './form-controls'
import { FormNotice, validationMessage } from './form-errors'

export type DocumentsFormValues = z.infer<typeof DocumentsInputSchema>
export type DocumentsFormProps = AsyncFormProps<DocumentsFormValues>

type DocumentCategory = DocumentsFormValues['documents'][number]['category']

const categoryOptions: readonly SelectOption<DocumentCategory>[] = [
  { value: 'financial', label: 'Financial record' },
  { value: 'hardship', label: 'Hardship evidence' },
  { value: 'identity', label: 'Identity document' },
  { value: 'ownership', label: 'Ownership record' },
  { value: 'other', label: 'Other supporting document' },
]

const maximumDocuments = 20
const maximumSizeBytes = 20_000_000

function formatSize(sizeBytes: number) {
  if (sizeBytes < 1_000_000) return `${Math.ceil(sizeBytes / 1_000)} KB`
  return `${(sizeBytes / 1_000_000).toFixed(1)} MB`
}

export function DocumentsForm({
  initialValues,
  onSubmit,
  submitError,
  onBack,
}: DocumentsFormProps) {
  const [fileError, setFileError] = useState<string>()
  const form = useForm({
    defaultValues: initialValues,
    validators: { onSubmit: DocumentsInputSchema },
    onSubmit: async ({ value }) => {
      await onSubmit(DocumentsInputSchema.parse(value))
    },
  })

  return (
    <form
      className="stack stack--large"
      aria-label="Supporting documents"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
    >
      <form.Field
        name="documents"
        mode="array"
        validators={{ onChange: DocumentsInputSchema.shape.documents }}
      >
        {(documentsField) => (
          <div className="stack stack--large">
            <InputField
              id="documents-add-files"
              label="Add supporting documents"
              type="file"
              multiple
              hint="Each file must be larger than 0 bytes and no more than 20 MB."
              error={fileError}
              disabled={documentsField.state.value.length >= maximumDocuments}
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? [])
                const openSlots = maximumDocuments - documentsField.state.value.length
                const accepted = files
                  .filter((file) => file.size > 0 && file.size <= maximumSizeBytes)
                  .slice(0, openSlots)

                if (files.some((file) => file.size === 0 || file.size > maximumSizeBytes)) {
                  setFileError('Remove empty files and files larger than 20 MB, then try again.')
                } else if (files.length > openSlots) {
                  setFileError(`You can add up to ${maximumDocuments} documents.`)
                } else {
                  setFileError(undefined)
                }

                for (const file of accepted) {
                  documentsField.pushValue({
                    id: globalThis.crypto.randomUUID(),
                    name: file.name,
                    category: 'other',
                    sizeBytes: file.size,
                    uploadedAt: new Date().toISOString(),
                  })
                }
                event.currentTarget.value = ''
              }}
            />

            {documentsField.state.value.length === 0 ? (
              <Alert tone="info" title="No documents added">
                Add at least one document before continuing.
              </Alert>
            ) : null}

            {documentsField.state.value.map((document, index) => (
              <Card key={document.id}>
                <SectionHeader
                  title={document.name || `Document ${index + 1}`}
                  description={`${formatSize(document.sizeBytes)} · Added ${new Date(
                    document.uploadedAt,
                  ).toLocaleDateString()}`}
                  action={
                    <Button
                      type="button"
                      variant="quiet"
                      size="small"
                      aria-label={`Remove ${document.name || `document ${index + 1}`}`}
                      onClick={() => documentsField.removeValue(index)}
                    >
                      Remove
                    </Button>
                  }
                />
                <div className="form-grid form-grid--2">
                  <form.Field
                    name={`documents[${index}].name`}
                    validators={{ onBlur: DocumentMetadataSchema.shape.name }}
                  >
                    {(field) => (
                      <TextControl
                        id={`document-${index}-name`}
                        label="Document name"
                        name={field.name}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={field.handleChange}
                        errors={field.state.meta.errors}
                        maxLength={200}
                        required
                      />
                    )}
                  </form.Field>

                  <form.Field
                    name={`documents[${index}].category`}
                    validators={{ onBlur: DocumentMetadataSchema.shape.category }}
                  >
                    {(field) => (
                      <SelectControl
                        id={`document-${index}-category`}
                        label="Document category"
                        name={field.name}
                        value={field.state.value}
                        options={categoryOptions}
                        onBlur={field.handleBlur}
                        onChange={field.handleChange}
                        errors={field.state.meta.errors}
                        required
                      />
                    )}
                  </form.Field>
                </div>
              </Card>
            ))}

            {validationMessage(documentsField.state.meta.errors) ? (
              <p className="field__error" role="alert">
                {validationMessage(documentsField.state.meta.errors)}
              </p>
            ) : null}
          </div>
        )}
      </form.Field>

      {submitError ? <FormNotice error={submitError} /> : null}
      <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
        {([canSubmit, isSubmitting]) => (
          <FormActions
            canSubmit={canSubmit}
            isSubmitting={isSubmitting}
            onBack={onBack}
            submitLabel="Save documents"
          />
        )}
      </form.Subscribe>
    </form>
  )
}
