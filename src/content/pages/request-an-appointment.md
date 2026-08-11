---
_mig:
  v: "0.1.0"
  gen: "content"
  hash: "b649ecbac2b2d372"
title: Request an Appointment
description: ""
canonical: https://www.r2dentistry.com//request-an-appointment.html
pageSections:
  - _component: page-sections/heroes/hero-split
    id: interior-banner
    eyebrow: Request a Dental Appointment in Wichita
    eyebrowColor: ""
    heading: Dental Care That Fits Your Schedule
    subtext: Are you finally ready to schedule an appointment with us here at our office in Wichita? Doing so has never been easier—you can simply fill out the brief questionnaire included below, which will ask for your name, contact details, and the reason for your visit. You shouldn’t have to wait very long at all to hear back from one of our team members, who will confirm your appointment timeslot and answer any initial questions you have.
    imageSource: /assets/images/request-a-dental-appointment-1.webp
    imageAlt: Hero image
    imageAspectRatio: none
    buttonSections: []
    reverse: false
    colorScheme: inherit
    backgroundColor: surface
    backgroundGradient: ""
    backgroundImage:
      source: ""
      alt: ""
      positionVertical: top
      positionHorizontal: center
  - _component: page-sections/forms/appt-form
    heading: Request an Appointment
    formAction: ""
    columnOne:
      - type: text
        name: Name
        label: Name
        required: true
      - type: tel
        name: Phone
        label: Phone
        required: true
      - type: email
        name: Email
        label: Email
        required: true
      - type: text
        name: insurance
        label: Your dental insurance
      - type: select
        name: Patient
        label: Are you a...
        required: true
        options:
          - New Patient
          - Existing Patient
    columnTwo:
      - type: select
        name: Communication
        label: Preferred Method of Communication
        options:
          - Phone
          - Text
          - Email
      - type: select
        name: Hear
        label: How'd you hear about us?
        required: true
        options:
          - Search Engine
          - Family/Friend
          - Promotion
          - Social Media
          - Other
      - type: select
        name: interested
        label: I am interested in...
        otherInputName: other-interest
        otherInputPlaceholder: Type your interest here...
        options:
          - Dental Checkup & Cleaning
          - Invisalign Clear Aligners
          - Veneers
          - Teeth Whitening
          - Gummy Smile
          - Dental Implants
          - Dentures
          - Crowns
          - Bridges
          - Fillings
          - Extractions
          - Emergency Dental Care
          - Other
      - type: textarea
        name: Comment
        label: Do you have any questions or comments?
    checkboxGroup:
      label: Preferred day(s) of the week
      name: day
      options:
        - Monday
        - Tuesday
        - Wednesday
        - Thursday
        - Friday
    submitText: Send
    subject: Request Appointment
    redirect: ""
---
