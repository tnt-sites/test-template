---
_schema: landing-page-pediatric-waves
title: Pediatric Waves Test
landingStyle: pediatric-waves
landingMainNav:
  - _component: navigation/landing/landing-header-pediatric-waves
    logoSource: /images/logo.svg
    logoAlt: Logo Alt
    pageButtons:
      - _component: building-blocks/core-elements/button
        id: ''
        text: Request an Appointment
        hideText: false
        link: /contact-us/
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
        uppercase: true
    offices: []
    addressLinkColor: var(--color-brand)
    addressLinkHoverColor: '#fff'
    phoneLinkColor: var(--color-brand-secondary)
    phoneLinkHoverColor: var(--color-brand)
    mobileCallLabel: Call Now
    mobileRequestLabel: Request a FREE Consultation
    mobileRequestHref: ''
    mobileBarBackground: ''
    mobileCallBackground: '#000'
    mobileRequestBackground: var(--color-brand-secondary)
    mobileCallTextColor: '#fff'
    mobileCallSmallTextColor: '#fff'
    mobileRequestTextColor: var(--color-brand)
    mobileRequestSmallTextColor: '#fff'
    mobileMapLabel: Map
    mobileMapHref: ''
    mobileApptBackground: '#dbe45a'
    mobileMapBackground: '#0d5f78'
landingFooter:
  - _component: navigation/landing/landing-footer-pediatric-waves
    logoSource: /images/logo.svg
    logoAlt: Logo
    contactTitle: Contact Us
    offices: []
    phoneLinkColor: '#fff'
    phoneLinkHoverColor: var(--color-brand)
    addressLinkColor: var(--color-brand)
    addressLinkHoverColor: '#fff'
    legalLinks:
      - name: Privacy Policy
        path: /privacy-policy/
      - name: Sitemap
        path: /sitemap/
    legalBlurb: ''
    linkColor: var(--color-brand)
    linkHoverColor: var(--color-brand-secondary)
    formHeading: Ask a Question
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
        label: Phone
        name: Phone
        type: text
        placeholder: Phone
        required: true
      - _component: building-blocks/forms/input
        id: ''
        label: Email
        name: Email
        type: email
        placeholder: Email
        required: true
      - _component: building-blocks/forms/textarea
        id: ''
        label: Comments
        name: CommentArea
        required: false
        placeholder: Comments
      - _component: building-blocks/forms/hidden
        id: ''
        name: _subject
        value: Pediatric Footer Questions
      - _component: building-blocks/forms/submit
        id: ''
        text: Send
        variant: primary
        size: md
        iconPosition: before
        hideText: false
        disabled: false
        class: footer-submit-button
    mapEmbedUrl: ''
    questionsLine: Have Questions? Get Answers
    backgroundColor: var(--color-bg-brand-secondary)
    officeHoursAlignment: left
    topWaveImage:
      source:
      alt: ''
    formMethod: post
    formSubject: Pediatric Footer Questions
    formRedirect: ''
    formButtonBorderRadius: 0px
    formButtonTextColor: ''
    formButtonBackgroundColor: ''
    formButtonHoverBackgroundColor: ''
    formButtonHoverTextColor: ''
    formButton:
      _component: building-blocks/core-elements/button
      text: Send
      hideText: false
      iconName: ''
      iconPosition: before
      variant: primary
      size: md
      width: md
      borderRadius: default
      borderWidth: default
      borderColor: default
      textColor: default
      uppercase: true
landingPageSections:
  - _component: landing-page-components/shared/top-bar
    id: ''
    backgroundColor: brand-secondary
    textColor: var(--color-text-inverse)
    items:
      - New Patients Welcome!
      - Same-Day Appointments
  - _component: landing-page-components/pediatric-waves/banner
    id: ''
    backgroundColor: base
    subheading: Board-Certified
    heading: <span>Pediatric</span><br>Dental Care
    listItems:
      - State-of-the-Art, New Practice
      - In-Network with Most Major Insurances
      - Same-Day Appointments Available
      - Fun, Interactive Environment
    image:
      source: https://placehold.co/900x780
      alt: Pediatric patient in dental chair
    buttonSections:
      - _component: building-blocks/wrappers/button-group
        buttons:
          - _component: building-blocks/core-elements/button
            id: ''
            text: Request an Appointment
            hideText: false
            link: /contact-us/
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
    headingColor: ''
    accentColor: ''
    waveTopImage:
      source: ''
      alt: ''
    waveMiddleImage:
      source: ''
      alt: ''
    waveBottomImage:
      source: ''
      alt: ''
  - _component: landing-page-components/pediatric-waves/split
    id: friendly-expertise
    backgroundColor: base
    heading: Friendly <span>Expertise</span>
    headingFontFamily: ''
    paragraphs:
      - body: >-
          We want kids to love visiting the dentist. Our team provides
          one-on-one attention to every child.
      - body: >-
          We understand kids, and our small team has completed advanced training
          specific to pediatric dentistry.
      - body: >-
          You can trust us to work with your family to build healthy habits that
          lead to a lifetime of smiles.
    image:
      source: https://placehold.co/900x760
      alt: Pediatric dentist with patient
    figcaption: Dr. Trent Miner
    reverse: false
    buttonSections:
      - _component: building-blocks/wrappers/button-group
        buttons:
          - _component: building-blocks/core-elements/button
            id: ''
            text: Meet Our Dentist
            hideText: false
            link: /meet-the-dentists/
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
    headingColor: ''
    accentColor: var(--color-brand-secondary)
    waveImage:
      source: ''
      alt: ''
  - _component: landing-page-components/pediatric-waves/review
    id: pediatric-review
    backgroundColor: base
    badgeHeading: Mom & Dad<br>Approved<br>Dentists
    badgeSubheading: Actual Google Review
    stars: 5
    reviewText: Lorem ipsum
    reviewerName: Laura N.
    reviewLogo:
      source: https://placehold.co/220x80
      alt: Google logo
    badgeBackgroundColor: '#0f5e75'
    headingColor: ''
    waveTopImage:
      source: ''
      alt: ''
    waveMiddleImage:
      source: ''
      alt: ''
    waveBottomImage:
      source: ''
      alt: ''
  - _component: landing-page-components/pediatric-waves/split
    id: one-stop-convenience
    backgroundColor: var(--color-bg-surface)
    heading: One-Stop Convenience
    headingFontFamily: ''
    paragraphs:
      - body: >-
          Life is busy, especially with kids. We offer everything from routine
          checkups and cleanings to preventive and restorative treatments in one
          place.
      - body: >-
          There is no need to spend extra time and money coordinating separate
          specialist visits.
    image:
      source: https://placehold.co/900x760
      alt: Modern pediatric treatment room
    figcaption: Our Treatment Room
    reverse: true
    buttonSections:
      - _component: building-blocks/wrappers/button-group
        buttons:
          - _component: building-blocks/core-elements/button
            id: ''
            text: Tour Our Office
            hideText: false
            link: /tour-our-office/
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
    headingColor: ''
    accentColor: var(--color-brand-secondary)
    waveImage:
      source: ''
      alt: ''
  - _component: landing-page-components/pediatric-waves/split
    id: flexible-affordable
    backgroundColor: base
    heading: Flexible & <span>Affordable</span>
    headingFontFamily: ''
    paragraphs:
      - body: >-
          If you have dental insurance, we are likely in-network and we work
          with all insurance plans to maximize your benefits.
      - body: >-
          If you are without insurance, we offer competitive fees and membership
          options designed for families.
      - body: >-
          Most importantly, we make prevention a priority so kids can keep
          healthy smiles while reducing long-term costs.
    image:
      source: https://placehold.co/900x760
      alt: Doctor with child patient
    figcaption: Dr. Miner with Patient
    reverse: false
    buttonSections:
      - _component: building-blocks/wrappers/button-group
        buttons:
          - _component: building-blocks/core-elements/button
            id: ''
            text: Learn More
            hideText: false
            link: /for-patients/
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
    headingColor: ''
    accentColor: var(--color-brand-secondary)
    waveImage:
      source: ''
      alt: ''
head_scripts: []
footer_scripts: []
extraFonts: []
---
