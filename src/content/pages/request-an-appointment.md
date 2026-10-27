---
_schema: default
title: Request an Appointment
description: ''
pageSections:
- _component: page-sections/heroes/interior-banner
  eyebrow: Request a Dental Appointment in Medford
  heading: Your Best Smile Starts Here
  subtext: Are you ready to take the next step toward a healthier, more confident smile? Do you have a
    friend or family member who needs a dental appointment? Scheduling a visit at our office is incredibly
    quick and easy. Just fill out the short form below with your preferred appointment date and time,
    as well as your contact information, and a member of our team will reach out to confirm your visit.
    New and returning patients are always welcome, and we can’t wait to see you in our office!
  overlay: medium
  showStripes: true
  backgroundImage:
    source: /src/assets/images/internal/request-an-appointment-1.webp
    alt: ''
    positionVertical: center
    positionHorizontal: center
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
    - value: traditional-braces
      label: Traditional Braces
    - value: invisalign
      label: Invisalign Clear Aligners
    - value: veneers
      label: Veneers
    - value: teeth-whitening
      label: Teeth Whitening
    - value: gummy-smile
      label: Gummy Smile
    - value: dental-implants
      label: Dental Implants
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
    value: /thanks/
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
    source: null
    alt: null
    positionVertical: top
    positionHorizontal: center
---
