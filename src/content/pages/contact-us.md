---
_mig:
  v: 0.1.0
  gen: content
  hash: 18952f0376b216c7
title: Contact Us
description: ""
canonical: /contact-us/
pageSections:
  - _component: page-sections/artisan/page-banner
    id: ""
    eyebrow: ""
    heading: Contact Us
    backgroundColor: "#321c0e"
    headingColor: "#ffffff"
    eyebrowColor: "#d2b22e"
    backgroundImage: ""
    overlayColor: rgba(50, 28, 14, 0.55)
    align: center
  - _component: page-sections/ctas/cta-form
    id: ""
    heading: "[Address](https://g.page/artisandds?share)"
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
        placeholder: null
        required: true
        value: null
      - _component: building-blocks/forms/input
        id: ""
        label: Last Name
        name: last_name
        type: text
        placeholder: null
        required: true
        value: null
      - _component: building-blocks/forms/hidden
        id: ""
        name: name
        value: ""
      - _component: building-blocks/forms/input
        id: ""
        label: Email
        name: email
        type: email
        placeholder: null
        required: true
        value: null
      - _component: building-blocks/forms/input
        id: ""
        label: Phone
        name: phone
        type: tel
        placeholder: null
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
      - _component: building-blocks/forms/textarea
        id: ""
        label: Notes / Comments
        name: message
        required: true
        placeholder: Notes / Comments
        value: null
      - _component: building-blocks/forms/input
        id: ""
        label: Name of Insurance
        name: name_of_insurance
        type: text
        placeholder: Name of Insurance
        required: true
        value: null
      - _component: building-blocks/forms/input
        id: ""
        label: Subscriber Name
        name: subscriber_name
        type: text
        placeholder: Subscriber Name
        required: true
        value: null
      - _component: building-blocks/forms/input
        id: ""
        label: Subscriber ID
        name: subscriber_id
        type: text
        placeholder: Subscriber ID
        required: true
        value: null
      - _component: building-blocks/forms/input
        id: ""
        label: "Group #"
        name: group_id
        type: text
        placeholder: "Group #"
        required: true
        value: null
      - _component: building-blocks/forms/recaptcha
        id: ""
        siteKey: null
      - _component: building-blocks/forms/submit
        id: ""
        text: Request Appointment
        variant: primary
        size: md
        iconName: null
        iconPosition: before
        hideText: false
        disabled: false
      - _component: building-blocks/forms/hidden
        id: ""
        name: _subject
        value: Appointment Request Form - Contact Us Page
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
          content: https://maps.google.com/maps?q=Artisan%20Dental%2010%20North%20Livingston%20Street%2C%20Suite%20301%2C%20Madison%2C%20WI%2053703&t=m&z=13&output=embed&iwloc=near
---
