---
_schema: landing-page-form
title: New Landing Page Form
parentLandingPage: ""
landingMainNav:
  - _component: navigation/landing/landing-header
    logoSource: /images/logo.svg
    logoAlt: Logo
    pageButtons:
      - _component: building-blocks/core-elements/button
        id: ""
        text: Request an Appointment
        hideText: false
        link: /request-an-appointment/
        modalTarget: ""
        iconName: ""
        iconPosition: before
        variant: primary
        size: md
        width: md
landingFooter:
  - _component: navigation/landing/landing-footer
    logoSource: /images/logo.svg
    logoAlt: Logo
    siteName: Dental Studio
    contactTitle: Contact Us
    legalLinks:
      - name: Sitemap
        path: sitemap.html
      - name: Privacy Policy
        path: privacy-policy.html
    socials:
      - label: Facebook
        icon: social/facebook
        link: https://facebook.com
      - label: Instagram
        icon: social/instagram
        link: https://instagram.com
    offices:
      - name: ""
        addresses:
          - lines:
              - 123 Main Street
              - Suite 200
            city: Dunedin
            state: FL
            postalCode: "34698"
            country: USA
            mapUrl: https://maps.google.com
        phones:
          - display: (123) 456-7890
            href: tel:+11234567890
landingPageSections:
  - _component: landing-page-components/shared/landing-page-form
    id: ""
    heading: Request an Appointment
    formAction: ""
    formBlocks:
      - _component: building-blocks/forms/input
        label: Name
        name: Name
        type: text
        placeholder: Name
        required: true
      - _component: building-blocks/forms/input
        label: Phone Number
        name: Phone
        type: text
        placeholder: Phone
        required: true
      - _component: building-blocks/forms/input
        label: Email Address
        name: email
        type: email
        placeholder: Email
        required: true
      - _component: building-blocks/forms/select
        label: Are you a new or existing patient?
        name: Patient
        placeholder: Are You A New Or Existing Patient?
        options:
          - value: New Patient
            label: New Patient
          - value: Existing Patient
            label: Existing Patient
      - _component: building-blocks/forms/select
        label: How did you hear about us?
        name: Discover
        placeholder: How Did You Hear About Us?
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
      - _component: building-blocks/forms/textarea
        label: Comments
        name: CommentArea
        placeholder: Comments
      - _component: building-blocks/forms/hidden
        name: _subject
        value: New Patient Request an Appointment
      - _component: building-blocks/forms/hidden
        name: _redirect
        value: thanks.html
      - _component: building-blocks/forms/submit
        text: Send
        variant: primary
    backgroundColor: base
    backgroundGradient: ""
    backgroundImage:
      source: null
      alt: null
      positionVertical: top
      positionHorizontal: center
head_scripts: []
footer_scripts: []
extraFonts: []
---
