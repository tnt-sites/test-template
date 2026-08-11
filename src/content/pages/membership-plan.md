---
_mig:
  v: "0.1.0"
  gen: "content"
  hash: "2f8f67e7fb394367"
title: Membership Plan
description: ""
canonical: https://www.r2dentistry.com//membership-plan.html
pageSections:
  - _component: page-sections/heroes/hero-split
    id: interior-banner
    eyebrow: In-House Dental Membership Plan Wichita
    eyebrowColor: ""
    heading: Easy to Sign Up & Simple to Use
    subtext: If you’re uninsured or underinsured, but you still want to receive top-tier dentistry from our team at R2 Center for Dentistry, consider signing up for our in-house dental membership plan. These annual plans offer an easier way to keep your oral health on the right track without having to worry about dental insurance claims, maximums, deductibles, or copayments. To sign up or learn more, [call our office](/contact/) today!
    imageSource: /assets/images/in-house-hental-membership-plan-1.webp
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
  - _component: page-sections/info-blocks/membership-plans
    heading: Our Yearly Plans
    plans:
      - name: Prophy Plan
        includesLabel: INCLUDES
        items:
          - text: 2 Professional Cleanings
          - text: All Dental Exams
          - text: All Required X-Rays
          - text: 2 Fluoride Treatments
          - text: 20% Discount on All Other Services
        priceCurrency: $
        priceAmount: "324"
        priceInterval: per year
        savings: 'Total Annual<br> Savings: $200'
        buttonText: Sign Up Today
        buttonLink: '#offer-modal'
      - name: Perio Plan
        includesLabel: INCLUDES
        items:
          - text: 4 Periodontal Maintenance Visits
          - text: All Dental Exams
          - text: All Required X-Rays
          - text: 20% Discount on Deep Cleanings (Scaling & Root Planing)
          - text: 20% Discount on All Other Dental Treatments
        priceCurrency: $
        priceAmount: "429"
        priceInterval: per year
        savings: 'Total Annual<br> Savings: $410'
        buttonText: Sign Up Today
        buttonLink: '#offer-modal'
    guidelinesHeading: Program Guidelines & Limitations
    guidelines: |-
      \*This program is a discount plan, not a dental insurance plan. There is *no* cancelation penalty. Patient’s portion is due the day of service.

      \*Plan cannot be used in conjunction with dental insurance or financing, such as CareCredit.

      \*Plan cannot be used for referrals to specialists, hospital charges, service of injuries covered under workers' compensation, or automobile medical insurance.
    signUpModal:
      enabled: true
      id: offer-modal
      formAction: ""
      fields:
        - type: text
          name: Name
          placeholder: Name
          required: true
        - type: tel
          name: Phone
          placeholder: Phone Number
        - type: email
          name: email
          placeholder: Email Address
          required: true
        - type: select
          name: patient
          placeholder: Are you a...
          options:
            - New Patient
            - Existing Patient
        - type: select
          name: hear
          placeholder: How Did You Hear About Us?
          options:
            - Search Engine
            - Family/Friend
            - Promotion
            - Social Media
            - Other
        - type: textarea
          name: question
          placeholder: Questions/Comments
      submitText: Send
      subject: Special Offer
      redirect: ""
---
