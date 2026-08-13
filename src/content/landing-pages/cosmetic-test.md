---
_schema: landing-page-cosmetic
title: New Cosmetic Landing Page
landingMainNav:
  - _component: navigation/landing/landing-header
    logoSource: /images/logo.svg
    logoAlt: Logo
    mobileCallSmallText: Call Now
    mobileRequestLabel: Request an Appointment
    mobileRequestHref: ''
    mobileCallBackgroundColor: ''
    mobileCallBackgroundColorHex: ''
    mobileRequestBackgroundColor: ''
    mobileRequestBackgroundColorHex: ''
    mobileCallTextColor: ''
    mobileCallSmallTextColor: ''
    mobileRequestTextColor: ''
    mobileRequestSmallTextColor: ''
    addressLinkColor: ''
    addressLinkHoverColor: ''
    phoneLinkColor: ''
    phoneLinkHoverColor: ''
    pageButtons:
      - _component: building-blocks/core-elements/button
        id: ''
        text: Request an Appointment
        hideText: false
        link: /cosmetic-special-form/
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
  - _component: navigation/landing/landing-footer-three-cards
    logoSource: /images/logo.svg
    logoAlt: Logo
    siteName: Dental Studio
    contactTitle: Contact Us
    featuredServicesTitle: Featured Services
    featuredServicesLinks:
      - name: Dental Implants
        path: /dental-implants/
      - name: Implant Bridge
        path: /dental-bridges/
      - name: Implant Dentures
        path: /implant-retained-dentures/
      - name: All-on-4
        path: /all-on-4/
    formTitle: Ask A Question
    formAction: ''
    formSubject: Landing Footer Form
    formRedirect: thanks.html
    formSubmitLabel: Submit
    formButtonBorderRadius: 0px
    formButtonTextColor: ''
    formButtonBackgroundColor: ''
    formButtonHoverBackgroundColor: ''
    formButtonHoverTextColor: ''
    footerLinksBackgroundColor: brand
    footerLinksHoverBackgroundColor: brand-secondary
    mapEmbedUrl: ''
    contactCardBackgroundColor: ''
    servicesCardBackgroundColor: ''
    formCardBackgroundColor: ''
    legalLinks:
      - name: Sitemap
        path: sitemap.html
      - name: Privacy Policy
        path: /privacy-policy/
    backgroundImage:
      source:
      alt:
      positionVertical: top
      positionHorizontal: center
    backgroundGradient: ''
    backgroundColor: ''
    backgroundColorHex: '#b42424'
    linkColor: ''
    linkHoverColor: ''
    addressLinkColor: ''
    addressLinkHoverColor: ''
    phoneLinkColor: ''
    phoneLinkHoverColor: ''
    legalBlurb: ''
    offices: []
landingPageSections:
  - _component: landing-page-components/cosmetic/banner
    id: ''
    backgroundColor: base
    backgroundColorHex: ''
    heading: Waco's Premier<br>Cosmetic <span>Dentists</span>
    tagline:
    subheading: >-
      We combine state-of-the-art technology, artistry, and concierge-level care
      to create smiles that change lives.
    image:
      source: https://placehold.co/700x600
      alt: Cosmetic dental team
    mobileImage:
      source: ''
      alt: ''
    figcaptionLinks:
      - name: Dr. Smith
        url: '#'
      - name: Dr. Jones
        url: '#'
    buttonSections: []
    accentColor: ''
    headingColor: ''
    fontHeadings: ''
    fontBody: ''
  - _component: landing-page-components/cosmetic/consultation
    id: ''
    backgroundColor: black
    backgroundColorHex: ''
    heading: Request a FREE Smile Makeover <span>Consultation</span>
    formAction: ''
    formBlocks:
      - _component: building-blocks/forms/input
        id: ''
        label: Name
        name: name
        type: text
        placeholder: Name
        required: true
      - _component: building-blocks/forms/input
        id: ''
        label: Phone Number
        name: phone
        type: tel
        placeholder: Phone Number
        required: true
      - _component: building-blocks/forms/input
        id: ''
        label: Email Address
        name: email
        type: email
        placeholder: Email Address
        required: true
      - _component: building-blocks/forms/textarea
        id: ''
        label: Questions/Comments
        name: message
        required: false
        placeholder: Questions/Comments
      - _component: building-blocks/forms/hidden
        id: ''
        name: _subject
        value: PPC - Cosmetic - Mid Page Form
      - _component: building-blocks/forms/hidden
        id: ''
        name: _redirect
        value: thanks.html
      - _component: building-blocks/forms/submit
        id: ''
        text: Submit
        variant: primary
        size: md
        iconPosition: before
        hideText: false
        disabled: false
    accentColor: '#ffbebe'
    headingColor: ''
    fontHeadings: ''
  - _component: landing-page-components/cosmetic/service-list
    id: ''
    backgroundColor: dark
    backgroundColorHex: ''
    services:
      - label: Veneers
        url: '#'
      - label: Smile Makeover
        url: '#'
      - label: Teeth Whitening
        url: '#'
      - label: Invisalign
        url: '#'
      - label: Dentures
        url: '#'
      - label: Dental Implants
        url: '#'
    accentColor: ''
  - _component: landing-page-components/cosmetic/split
    id: ''
    backgroundColor: base
    backgroundColorHex: ''
    heading: Nobody Cares <br><span>More</span>
    paragraphs:
      - >-
        Every dentist tries to impress you with what they know. We go about
        things differently. We start by getting to know you.
      - >-
        Once we understand you and your goals, we unleash our experience and
        knowledge to develop a customized plan for your smile.
    image:
      source: https://placehold.co/580x420
      alt: Dental team
    figcaption: Our Amazing Dental Team
    buttonSections: []
    reverse: false
    accentColor: ''
    headingColor: ''
    fontHeadings: ''
    fontBody: ''
  - _component: landing-page-components/cosmetic/reviews
    id: ''
    backgroundColor: base
    backgroundColorHex: ''
    heading: Patients Love Us
    reviewText: >-
      Dr. Smith is so nice and does a great job. His assistant makes my visit
      enjoyable!
    author: Regina W.
    buttonSections: []
    sliderHeading: Actual Patient Results
    sliderSubheading: Before & After
    beforeImage:
      source: /src/assets/images/component-library/profile.jpg
      alt: A smile before cosmetic work
    afterImage:
      source: /src/assets/images/component-library/profile2.jpg
      alt: A beautiful smile after cosmetic work
    starColor: '#fcd800'
    accentColor: ''
    headingColor: ''
    handleColor: dark
    handleArrowColor: white
    fontHeadings: ''
    reviewsUrl: '#'
    reviewsButtonText: Read More Reviews
head_scripts: []
footer_scripts: []
extraFonts: []
---
