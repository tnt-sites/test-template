---
_schema: landing-page-form
title: New Landing Page Form
parentLandingPage: ''
landingMainNav:
  - _component: navigation/landing/landing-header
    logoSource: /images/logo.svg
    logoAlt: Logo
    pageButtons:
      - _component: building-blocks/core-elements/button
        id: ''
        text: Request an Appointment
        hideText: false
        link: /request-an-appointment/
        modalTarget: ''
        iconName: ''
        iconPosition: before
        variant: primary
        size: md
        width: md
        borderRadius: default
        borderWidth: default
        borderColor: default
        textColor: default
        uppercase: false
    offices: []
landingFooter:
  - _component: navigation/landing/landing-footer
    logoSource: /images/logo.svg
    logoAlt: Logo
    siteName: Dental Studio
    contactTitle: Contact Us
    pageButtons:
      - _component: building-blocks/core-elements/button
        id: ''
        text: Request an Appointment
        hideText: false
        link: /request-an-appointment/
        modalTarget: ''
        iconName: ''
        iconPosition: before
        variant: primary
        size: md
        width: md
        borderRadius: default
        borderWidth: default
        borderColor: default
        textColor: default
        uppercase: false
    socials:
      - label: Facebook
        icon: social/facebook
        link: https://facebook.com
      - label: Instagram
        icon: social/instagram
        link: https://instagram.com
    legalLinks:
      - name: Sitemap
        path: sitemap.html
      - name: Privacy Policy
        path: /privacy-policy/
    mapEmbedUrl: ''
    backgroundImage:
      positionVertical: top
      positionHorizontal: center
    backgroundGradient: ''
    backgroundColor: ''
    linkColor: ''
    linkHoverColor: ''
    legalBlurb: ''
    offices:
      - name: ''
        phones:
          - display: (123) 456-7890
            href: tel:+11234567890
        addresses:
          - lines:
              - 123 Main Street
              - Suite 200
            city: Dunedin
            state: FL
            postalCode: '34698'
            country: USA
            mapUrl: https://maps.google.com
        officeHours: []
        officeHoursNote: ''
landingPageSections:
  - _component: landing-page-components/shared/landing-page-form
    id: ''
    heading: Request an Appointment
    formAction: ''
    formBlocks:
      - _component: building-blocks/forms/input
        id: ''
        label: Name
        name: Name
        type: text
        placeholder: Name
        required: true
      - _component: building-blocks/forms/input
        id: ''
        label: Phone Number
        name: Phone
        type: text
        placeholder: Phone
        required: true
      - _component: building-blocks/forms/input
        id: ''
        label: Email Address
        name: email
        type: email
        placeholder: Email
        required: true
      - _component: building-blocks/forms/select
        id: ''
        label: Are you a new or existing patient?
        name: Patient
        required: false
        options:
          - value: New Patient
            label: New Patient
          - value: Existing Patient
            label: Existing Patient
        placeholder: Are You A New Or Existing Patient?
      - _component: building-blocks/forms/select
        id: ''
        label: How did you hear about us?
        name: Discover
        required: false
        options:
          - value: search engine
            label: Search Engine
          - value: family
            label: Family/Friend
          - value: promotion
            label: Promotion
          - value: social media
            label: Social Media
          - value: other
            label: Other
        placeholder: How Did You Hear About Us?
      - _component: building-blocks/forms/textarea
        id: ''
        label: Comments
        name: CommentArea
        required: false
        placeholder: Comments
      - _component: building-blocks/forms/hidden
        id: ''
        name: _subject
        value: New Patient Request an Appointment
      - _component: building-blocks/forms/hidden
        id: ''
        name: _redirect
        value: thanks.html
      - _component: building-blocks/forms/submit
        id: ''
        text: Send
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
head_scripts: []
footer_scripts: []
extraFonts: []
---
