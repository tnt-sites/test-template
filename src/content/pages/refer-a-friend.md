---
title: Refer a Friend to Our Dentist in Springfield, MA | Taylor Street Dental
pageSections:
  - _component: page-sections/heroes/hero-banner
    id: ''
    eyebrow: Refer a Friend to Our Dentist in Springfield
    heading: We Appreciate Your Trust in Us!
    subtext: Have you been coming to Taylor Street Dental for years? It’s always a big compliment for us to receive a new patient by a word-of-mouth referral, and we want you to know how much we appreciate your trust in our team. We love when you share our office with your friends, family, and co-workers!
    imageSource: /src/assets/images/pages/refer-a-friend/refer-a-friend-1.webp
    imageAlt: Two women sitting in chairs across from each other
    buttonSections: []
    colorScheme: inherit
    backgroundColor: brand
    backgroundColorHex: ''
    backgroundGradient: ''
    backgroundImage:
      source: ''
      alt: ''
      positionVertical: top
      positionHorizontal: center
  - _component: page-sections/forms/referral-form
    id: ''
    heading: Refer a Patient
    subtext: ''
    formAction: https://tnt-adder.herokuapp.com/submit/da95fdca-d6ec-408e-a948-5fa702084428
    formBlocks:
      - _component: building-blocks/forms/input
        label: Your Name
        name: name
        type: text
        required: true
      - _component: building-blocks/forms/input
        label: Your Email
        name: email
        type: email
        required: true
      - _component: building-blocks/forms/input
        label: Your Phone
        name: phone
        type: tel
        required: false
      - _component: building-blocks/forms/input
        label: Patient’s Name
        name: patient-name
        type: text
        required: true
      - _component: building-blocks/forms/input
        label: Patient’s Email
        name: patient-email
        type: email
        required: true
      - _component: building-blocks/forms/input
        label: Patient’s Phone
        name: patient-phone
        type: tel
        required: true
      - _component: building-blocks/forms/textarea
        label: Reason for Referral
        name: reason
        required: true
      - _component: building-blocks/forms/textarea
        label: Description of Previous Treatments
        name: treatments
        required: false
      - _component: building-blocks/forms/select
        label: Are You a...
        name: patient
        required: false
        placeholder: Select one
        options:
          - value: new-patient
            label: New Patient
          - value: existing-patient
            label: Existing Patient
      - _component: building-blocks/forms/select
        label: How Did You Hear About Us?
        name: hear
        required: false
        placeholder: Select one
        options:
          - value: search-engine
            label: Search Engine
          - value: family-friend
            label: Family/Friend
          - value: promotion
            label: Promotion
          - value: social-media
            label: Social Media
          - value: other
            label: Other
      - _component: building-blocks/forms/hidden
        name: _subject
        value: Refer a Friend
      - _component: building-blocks/forms/hidden
        name: _redirect
        value: /thanks/
      - _component: building-blocks/forms/recaptcha
        id: ''
        siteKey: null
        theme: light
        size: normal
      - _component: building-blocks/forms/submit
        text: Submit
        variant: primary
    backgroundColor: base
    backgroundGradient: ''
    backgroundImage:
      source: null
      alt: null
      positionVertical: top
      positionHorizontal: center
description: ''
---
