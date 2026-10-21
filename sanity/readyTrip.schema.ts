import {defineField, defineType} from 'sanity'

const list = (values: string[]) => ({list: values.map((v) => ({title: v, value: v}))})

export const readyTrip = defineType({
  name: 'readyTrip',
  title: 'Ready-made trip',
  type: 'document',
  orderings: [{title: 'Order', name: 'order', by: [{field: 'order', direction: 'asc'}]}],
  fields: [
    defineField({name: 'title', type: 'string', validation: (r) => r.required()}),
    defineField({name: 'slug', type: 'slug', options: {source: 'title', maxLength: 96}, validation: (r) => r.required()}),
    defineField({name: 'destination', type: 'string', description: 'City or region, then country, as a geocoder would read it', validation: (r) => r.required()}),
    defineField({name: 'country', type: 'string', validation: (r) => r.required()}),
    defineField({
      name: 'region',
      type: 'string',
      options: list(['Europe', 'Middle East', 'Asia', 'Africa', 'Americas', 'Oceania']),
      validation: (r) => r.required(),
    }),
    defineField({name: 'monument', type: 'string', description: 'Big uppercase name shown on the card'}),
    defineField({name: 'days', type: 'number', validation: (r) => r.required().integer().min(2).max(10)}),
    defineField({name: 'priceFrom', type: 'number', description: 'USD per person, excluding flights', validation: (r) => r.required().min(0)}),
    defineField({name: 'priceNote', type: 'string', initialValue: 'Estimate per person, excluding flights'}),
    defineField({
      name: 'pace',
      type: 'string',
      options: list(['Slow', 'Easy pace', 'Balanced', 'Full days']),
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'tags',
      type: 'array',
      of: [{type: 'string'}],
      options: list(['Desert', 'Coast', 'Food', 'Mountains', 'History', 'City', 'Nature', 'Winter', 'Islands', 'Wine']),
    }),
    defineField({name: 'weekend', type: 'boolean', description: 'True when days <= 3', initialValue: false}),
    defineField({
      name: 'bestMonths',
      type: 'array',
      of: [{type: 'number'}],
      description: 'Month numbers 1-12',
      validation: (r) => r.unique().custom((v) => (v ?? []).every((m) => Number.isInteger(m) && m >= 1 && m <= 12) || 'Months must be 1-12'),
    }),
    defineField({name: 'summary', type: 'text', rows: 3}),
    defineField({name: 'featured', type: 'boolean', initialValue: false}),
    defineField({name: 'order', type: 'number'}),
    defineField({
      name: 'itinerary',
      type: 'array',
      of: [
        {
          type: 'object',
          name: 'itineraryDay',
          fields: [
            defineField({name: 'day', type: 'number', validation: (r) => r.required().integer().min(1)}),
            defineField({name: 'theme', type: 'string'}),
            defineField({
              name: 'stops',
              type: 'array',
              validation: (r) => r.min(3).max(4),
              of: [
                {
                  type: 'object',
                  name: 'stop',
                  fields: [
                    defineField({name: 'name', type: 'string', validation: (r) => r.required()}),
                    defineField({name: 'kind', type: 'string', options: list(['sight', 'food', 'walk', 'rest', 'view'])}),
                    defineField({name: 'note', type: 'string'}),
                  ],
                },
              ],
            }),
          ],
          preview: {select: {title: 'theme', subtitle: 'day'}, prepare: ({title, subtitle}) => ({title, subtitle: `Day ${subtitle}`})},
        },
      ],
    }),
  ],
  preview: {select: {title: 'title', subtitle: 'destination'}},
})
