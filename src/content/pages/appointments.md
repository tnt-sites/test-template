---
_mig:
  v: 0.1.0
  gen: content
  hash: 26b91f23f68a308d
title: Appointments
description: ""
canonical: /appointments/
pageSections:
  - _component: page-sections/artisan/page-banner
    id: ""
    eyebrow: ""
    heading: Appointments
    backgroundColor: "#321c0e"
    headingColor: "#ffffff"
    eyebrowColor: "#d2b22e"
    backgroundImage: /wp-content/uploads/2020/08/brown-wood-texture-and-backgroun-1-1.jpg
    overlayColor: rgba(50, 28, 14, 0.55)
    align: center
    minHeight: 200px
  - _component: page-sections/artisan/contact-block
    id: ""
    heading: Appointment Request Form
    details: []
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
        placeholder: First Name
        required: true
        value: null
      - _component: building-blocks/forms/input
        id: ""
        label: Last Name
        name: last_name
        type: text
        placeholder: Last Name
        required: true
        value: null
      - _component: building-blocks/forms/hidden
        id: ""
        name: name
        value: ""
      - _component: building-blocks/forms/input
        id: ""
        label: Email Address
        name: email
        type: email
        placeholder: Email Address
        required: true
        value: null
      - _component: building-blocks/forms/input
        id: ""
        label: Phone
        name: phone
        type: tel
        placeholder: Phone
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
      - _component: building-blocks/forms/date
        id: ""
        label: Appointment Date
        name: appointment_date
        required: true
        value: null
        min: null
        max: null
      - _component: building-blocks/forms/select
        id: ""
        label: Requested Time
        name: requested_time
        required: true
        options: []
        placeholder: Requested Time (Choose "Appointment Date" first)
      - _component: building-blocks/forms/textarea
        id: ""
        label: Notes / Comments
        name: message
        required: true
        placeholder: Notes / Comments
        value: null
      - _component: building-blocks/forms/recaptcha
        id: ""
        siteKey: null
      - _component: building-blocks/forms/submit
        id: ""
        text: Submit
        variant: primary
        size: md
        iconName: null
        iconPosition: before
        hideText: false
        disabled: false
      - _component: building-blocks/forms/hidden
        id: ""
        name: _subject
        value: Appointment Request Form - Appointments Page
    formAction: /thank-you/
    mapEmbedUrl: https://maps.google.com/maps?q=10%20North%20Livingston%20Street%2C%20Suite%20301%2C%20Madison%2C%20WI%2053703&t=m&z=13&output=embed&iwloc=near
    mapHeight: 380px
    backgroundColor: "#ffffff"
    headingColor: "#321c0e"
    labelColor: "#321c0e"
    textColor: "#333333"
  - _component: page-sections/artisan/split-feature
    id: ""
    eyebrow: ""
    heading: Appointment Request Form
    text: <p></p>
    image: ""
    buttonText: ""
    buttonLink: ""
    reverse: false
    align: left
    mediaMinHeight: 0px
    backgroundColor: transparent
    eyebrowColor: "#d2b22e"
    headingColor: "#321c0e"
    textColor: "#333333"
  - _component: page-sections/artisan/split-feature
    id: ""
    eyebrow: ""
    heading: Office Hours
    text: "

      \t\t\t\t<div class=\"elementor-widget-container\">

      \t\t\t\t\t\t\t\t\t<table class=\"hours\"><tbody><tr class=\"day odd\"><th>Sun</th><td>Closed</td><td colspan=\"2\">&nbsp;</td><td>&nbsp;</td></tr><tr class=\"day even\"><th>Mon</th><td>7:00 AM</td><td colspan=\"2\">&nbsp;–</td><td>5:00 PM</td></tr><tr class=\"day odd\"><th>Tue</th><td>7:00 AM</td><td colspan=\"2\">&nbsp;–</td><td>5:00 PM</td></tr><tr class=\"day even\"><th>Wed</th><td>7:00 AM</td><td colspan=\"2\">&nbsp;–</td><td>5:00 PM</td></tr><tr class=\"day odd\"><th>Thur</th><td>7:00 AM</td><td colspan=\"2\">&nbsp;–</td><td>5:00 PM</td></tr><tr class=\"day even\"><th>Fri</th><td>7:00 AM</td><td colspan=\"2\">&nbsp;–</td><td>5:00 PM</td></tr><tr class=\"day odd\"><th>Sat</th><td>Closed</td><td>&nbsp;</td></tr></tbody></table>\t\t\t\t\t\t\t\t</div>

      \t\t\t\t"
    image: ""
    buttonText: ""
    buttonLink: ""
    reverse: false
    align: left
    mediaMinHeight: 0px
    backgroundColor: transparent
    eyebrowColor: "#d2b22e"
    headingColor: "#321c0e"
    textColor: "#333333"
  - _component: page-sections/artisan/contact-block
    id: ""
    heading: Additional Information
    details: []
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
        placeholder: First Name
        required: true
        value: null
      - _component: building-blocks/forms/input
        id: ""
        label: Last Name
        name: last_name
        type: text
        placeholder: Last Name
        required: true
        value: null
      - _component: building-blocks/forms/hidden
        id: ""
        name: name
        value: ""
      - _component: building-blocks/forms/input
        id: ""
        label: Email Address
        name: email
        type: email
        placeholder: Email Address
        required: true
        value: null
      - _component: building-blocks/forms/input
        id: ""
        label: Phone
        name: phone
        type: tel
        placeholder: Phone
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
      - _component: building-blocks/forms/date
        id: ""
        label: Appointment Date
        name: appointment_date
        required: true
        value: null
        min: null
        max: null
      - _component: building-blocks/forms/select
        id: ""
        label: Requested Time
        name: requested_time
        required: true
        options: []
        placeholder: Requested Time (Choose "Appointment Date" first)
      - _component: building-blocks/forms/textarea
        id: ""
        label: Notes / Comments
        name: message
        required: true
        placeholder: Notes / Comments
        value: null
      - _component: building-blocks/forms/recaptcha
        id: ""
        siteKey: null
      - _component: building-blocks/forms/submit
        id: ""
        text: Submit
        variant: primary
        size: md
        iconName: null
        iconPosition: before
        hideText: false
        disabled: false
      - _component: building-blocks/forms/hidden
        id: ""
        name: _subject
        value: Appointment Request Form - Appointments Page
    formAction: /thank-you/
    mapEmbedUrl: https://maps.google.com/maps?q=10%20North%20Livingston%20Street%2C%20Suite%20301%2C%20Madison%2C%20WI%2053703&t=m&z=13&output=embed&iwloc=near
    mapHeight: 380px
    backgroundColor: "#ffffff"
    headingColor: "#321c0e"
    labelColor: "#321c0e"
    textColor: "#333333"
---
