---
_mig:
  v: 0.1.0
  gen: content
  hash: 26b91f23f68a308d
title: Appointments
description: ""
canonical: /appointments/
pageSections:
  - _component: page-sections/artisan/page-banner
    id: ""
    eyebrow: ""
    heading: Appointments
    backgroundColor: "#321c0e"
    headingColor: "#ffffff"
    eyebrowColor: "#d2b22e"
    backgroundImage: /wp-content/uploads/2020/08/brown-wood-texture-and-backgroun-1-1.jpg
    overlayColor: rgba(50, 28, 14, 0.55)
    align: center
    minHeight: 420px
  - _component: page-sections/ctas/cta-form
    id: ""
    heading: "[Printable Contact Information](/wp-content/uploads/2020/08/Artisan-Dental-Contact-Information-1-1.pdf)"
    subtext: ""
    formAction: /thank-you/
    formBlocks:
      - _component: building-blocks/forms/choice-group
        id: ""
        title: Patient Type
        name: patient_type
        required: true
        options:
          - value: New Patient
            label: New Patient
            checked: false
          - value: Existing Patient
            label: Existing Patient
            checked: false
        orientation: horizontal
        multiple: false
      - _component: building-blocks/forms/input
        id: ""
        label: First Name
        name: first_name
        type: text
        placeholder: First Name
        required: true
        value: null
      - _component: building-blocks/forms/input
        id: ""
        label: Last Name
        name: last_name
        type: text
        placeholder: Last Name
        required: true
        value: null
      - _component: building-blocks/forms/hidden
        id: ""
        name: name
        value: ""
      - _component: building-blocks/forms/input
        id: ""
        label: Email Address
        name: email
        type: email
        placeholder: Email Address
        required: true
        value: null
      - _component: building-blocks/forms/input
        id: ""
        label: Phone
        name: phone
        type: tel
        placeholder: Phone
        required: true
        value: null
      - _component: building-blocks/forms/date
        id: ""
        label: Date Of Birth
        name: date_of_birth
        required: true
        value: null
        min: null
        max: null
      - _component: building-blocks/forms/input
        id: ""
        label: Insurance Provider
        name: insurance_provider
        type: text
        placeholder: Insurance Provider
        required: true
        value: null
      - _component: building-blocks/forms/input
        id: ""
        label: How did you hear about us?
        name: how_you_heard_about_us
        type: text
        placeholder: How did you hear about us?
        required: true
        value: null
      - _component: building-blocks/forms/date
        id: ""
        label: Appointment Date
        name: appointment_date
        required: true
        value: null
        min: null
        max: null
      - _component: building-blocks/forms/select
        id: ""
        label: Requested Time
        name: requested_time
        required: true
        options: []
        placeholder: Requested Time (Choose "Appointment Date" first)
      - _component: building-blocks/forms/textarea
        id: ""
        label: Notes / Comments
        name: message
        required: true
        placeholder: Notes / Comments
        value: null
      - _component: building-blocks/forms/recaptcha
        id: ""
        siteKey: null
      - _component: building-blocks/forms/submit
        id: ""
        text: Submit
        variant: primary
        size: md
        iconName: null
        iconPosition: before
        hideText: false
        disabled: false
      - _component: building-blocks/forms/hidden
        id: ""
        name: _subject
        value: Appointment Request Form - Appointments Page
    imageSource: /wp-content/uploads/2021/05/FFPC-winner-logo2-1-rev.png
    imageAlt: FFPC winner logo
    reverse: false
    colorScheme: inherit
    backgroundColor: base
    backgroundGradient: ""
    backgroundImage:
      source: ""
      alt: ""
      positionVertical: top
      positionHorizontal: center
_migUnmapped:
  sections:
    - component: page-sections/ctas/cta-form
      fields:
        - field: mapEmbedUrl
          content: https://maps.google.com/maps?q=10%20North%20Livingston%20Street%2C%20Suite%20301%2C%20Madison%2C%20WI%2053703&t=m&z=13&output=embed&iwloc=near
---
