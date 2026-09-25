# What to check

Checklist to run over a scenario once the ticket's steps are written. Pick the sections the diff touches, skip the rest.

Some checks may be missing. Append to this file when a new miss is found.

## Form

### Each input, on create and on update

- set a value, save, reopen: the value must be there
- leave an optional input empty, save: no crash, stored empty
- change the value, save, reopen: it changed with the new value
- clear the value, save, reopen: the field is now empty
- open the form and save without touching anything: nothing changed
- clear a required input: a field-level error, not a generic flash and not a 500
- omit the input from the payload entirely, rather than blanking it: a field-level error, not a generic flash and not a 500
- a value at the column's max length, and one over it
- a value the merchant's locale produces: `48,8566` for a decimal, accents, leading and trailing spaces
- a value storage can hold but the widget cannot render: three slots in a two-slot widget
- `0` and a negative number, where the input is numeric
- values in the wrong type (i.e strings in numeric fields)
- the same edit twice in a row

### The form as a whole

- default values on the create form (preselected country, active switch)
- translatable inputs:
  - On creation:
    - Fill one language that is not the default one: an error appears requesting the default one to be filled
    - Fill the default value and save: the other languages without value are filled with the value of the default language 
  - On edition:
    - fill one language only, save, check the other is untouched
- upload an image, then replace it, then delete the record
- Confirm the result from the database, not from the flash message. A save that changed nothing still says *Successful update*.

## Grid and listing

- every column shows the value the record actually has
- filter, sort and reset on each column
- filters survive a page reload
- row actions: edit, delete, toggle status
- bulk actions on a selection, and on none
- delete leaves no orphan rows behind
- for each draggable element, attempt drag and drops 

## Clients that are not a browser

The browser enforces `required`, `maxlength` and the form's JavaScript but are technically avoidable. This part makes sure the same checks are done on the server-side.

- post with a required field removed from the body: a validation error, not a 500
- post the raw value the merchant typed, skipping the JavaScript that normalises it
- post an id that is not in the select

Play with the payloads and post through the page's own request context, not by navigating: a navigation answering 500 is recorded as a failed precondition and voids the run.

## Migration parity

- what the legacy controller did after saving: normalisation, cache invalidation, image loop
- every `Hook::exec()` the legacy controller fired
- the wording of each validation message
- what legacy rejected and the new page accepts, and the reverse (the reverse is sometimes an improvement, worth one line in the report)

### In forms
- The field order matches the page being replaced
- The default values are the same
- Required inputs are the same set as before

## Errors and messages

- every exception code the domain throws has a message mapped
- every mapped code is actually thrown somewhere (a mapped code never thrown usually means the real one was forgotten)

## Images

- every configured generation format is produced, not only JPG
- the theme template's `<source>` elements resolve
- replacing an image removes the old derivatives
- a file that is not an image is refused, and one over the upload limit too

## Multistore

- the shop association is stored and honoured on read
- a record in shop A is invisible from shop B
- editing from an "all shops" context does not reassign the record
- the association survives an edit that never touches that field

## Admin-API

*To do*