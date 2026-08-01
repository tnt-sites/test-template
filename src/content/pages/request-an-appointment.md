---
_schema: default
title: Request a Dental Appointment in Hays
pageSections:
  - _component: page-sections/heroes/hero-split
    id: ''
    eyebrow: Request a Dental Appointment in Hays
    heading: Plan Your Next Visit with Us
    subtext: >-
      Interested in scheduling a dental appointment in Hays? Simply fill
      out the requested information on the form below and press submit.
      Once our team receives your information, we'll reach out to you to
      find the best time and date to plan your upcoming visit to
      Lifetime Dental Care. We're also happy to answer any questions you
      may have on the phone, so don't hesitate to call us during
      business hours.
    imageSource: /src/assets/images/request-appointment-1.webp
    imageAlt: Woman talking on the phone with a dental office in Hays
    buttonSections: []
    reverse: false
    colorScheme: contrast
    backgroundColor: dark
  - _component: page-sections/forms/appointment-form
    id: ''
    heading: Request an Appointment
    subtext: ''
    formAction: ./
    formBlocks:
      - _component: building-blocks/forms/input
        id: ''
        label: Name
        name: name
        type: text
        required: true
      - _component: building-blocks/forms/select
        id: ''
        label: Are You a...
        name: patient
        required: true
        options:
          - value: new-patient
            label: New Patient
          - value: existing-patient
            label: Existing Patient
        placeholder: Select one
      - _component: building-blocks/forms/input
        id: ''
        label: Phone
        name: phone
        type: tel
        required: true
      - _component: building-blocks/forms/select
        id: ''
        label: Preferred Method of Communication
        name: communication
        required: false
        options:
          - value: phone
            label: Phone
          - value: text
            label: Text
          - value: email
            label: Email
        placeholder: Select one
      - _component: building-blocks/forms/input
        id: ''
        label: Email
        name: email
        type: email
        required: true
      - _component: building-blocks/forms/select
        id: ''
        label: How'd You Hear About Us?
        name: hear
        required: true
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
        placeholder: Select one
      - _component: building-blocks/forms/input
        id: ''
        label: Your Dental Insurance
        name: insurance
        type: text
        required: false
      - _component: building-blocks/forms/select
        id: ''
        label: I Am Interested In...
        name: interested
        required: false
        options:
          - value: dental-checkup-cleaning
            label: Dental Checkup & Cleaning
          - value: dental-implants
            label: Dental Implants
          - value: invisalign
            label: Invisalign Clear Aligners
          - value: veneers
            label: Veneers
          - value: teeth-whitening
            label: Teeth Whitening
          - value: dentures
            label: Dentures
          - value: crowns
            label: Crowns
          - value: bridges
            label: Bridges
          - value: fillings
            label: Fillings
          - value: extractions
            label: Extractions
          - value: emergency-dental-care
            label: Emergency Dental Care
          - value: other
            label: Other
        placeholder: Select one
      - _component: building-blocks/forms/choice-group
        id: ''
        title: Preferred Day(s) of the Week
        name: day
        required: false
        options:
          - value: monday
            label: Monday
            checked: false
          - value: tuesday
            label: Tuesday
            checked: false
          - value: wednesday
            label: Wednesday
            checked: false
          - value: thursday
            label: Thursday
            checked: false
        orientation: horizontal
        multiple: true
      - _component: building-blocks/forms/textarea
        id: ''
        label: Questions or Comments
        name: comment
        required: false
      - _component: building-blocks/forms/hidden
        id: ''
        name: _subject
        value: Request Appointment
      - _component: building-blocks/forms/hidden
        id: ''
        name: _redirect
        value: /thanks
      - _component: building-blocks/forms/submit
        id: ''
        text: Submit
        variant: primary
        size: md
        iconPosition: before
        hideText: false
        disabled: false
    backgroundColor: base
    backgroundGradient: ''
    backgroundImage:
      source:
      alt:
      positionVertical: top
      positionHorizontal: center
description: >-
  Request a dental appointment at Lifetime Dental Care in Hays, KS. Fill
  out the form and we'll reach out to schedule your visit.
---
