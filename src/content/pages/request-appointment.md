---
_mig:
  v: 0.1.0
  gen: content
  hash: f72066cae08d6884
title: Request Appointment
description: ""
canonical: /request-appointment/
pageSections:
  - _component: page-sections/artisan/page-banner
    id: ""
    eyebrow: ""
    heading: Request Appointment
    backgroundColor: "#321c0e"
    headingColor: "#ffffff"
    eyebrowColor: "var(--color-brand-secondary)"
    backgroundImage: ""
    overlayColor: rgba(50, 28, 14, 0.55)
    align: center
    minHeight: ""
  - _component: page-sections/artisan/page-body
    id: ""
    sidebarHeading: ""
    links: []
    image: ""
    imageAlt: ""
    body: "
      <h2 class=\"elementor-heading-title elementor-size-default\">Appointment Request Form</h2>
      <div class=\"tnt-form form-request-appointment-request-appointment-page\">
      <form action=\"/wp-admin/admin-post.php\" class=\"recaptcha-form\" method=\"post\" data-no-elementor-submit=\"\">
      <!-- Form Validator -->
      <input type=\"hidden\" name=\"action\" value=\"artisan_dental_form_validator\">
      <!-- Patient Type -->
      <div class=\"form-row checkboxes\">
      <label class=\"radio-inline\"><input type=\"radio\" name=\"patient_type\" value=\"New Patient\" required=\"\"> New Patient</label>
      <label class=\"radio-inline\"><input type=\"radio\" name=\"patient_type\" value=\"Existing Patient\" required=\"\"> Existing Patient</label>
      </div>
      <!-- Name -->
      <div class=\"form-row half\">
      <div class=\"column\"><input type=\"text\" class=\"first_name\" name=\"first_name\" placeholder=\"First Name\" required=\"\"></div>
      <div class=\"column\"><input type=\"text\" class=\"last_name\" name=\"last_name\" placeholder=\"Last Name\" required=\"\"></div>
      <!-- Full Name: Combines first_name & last_name -->
      <input type=\"hidden\" name=\"name\">
      </div>
      <!-- Email -->
      <div class=\"form-row full\">
      <input type=\"email\" name=\"email\" placeholder=\"Email Address\" required=\"\">
      </div>
      <!-- Phone / DOB -->
      <div class=\"form-row half\">
      <div class=\"column\"><input type=\"tel\" name=\"phone\" placeholder=\"Phone\" required=\"\"></div>
      <div class=\"column\"><input type=\"date\" name=\"date_of_birth\" class=\"date-input all-dates date-empty\" autocomplete=\"bday\" data-placeholder=\"DOB: mm/dd/yyyy\" required=\"\"></div>
      </div>
      <!-- Insurance -->
      <div class=\"form-row full\">
      <input type=\"text\" name=\"insurance_provider\" placeholder=\"Insurance Provider\" required=\"\">
      </div>
      <!-- How did you hear about us? -->
      <div class=\"form-row full\">
      <input type=\"text\" name=\"how_you_heard_about_us\" placeholder=\"How did you hear about us?\" required=\"\">
      </div>
      <!-- Requested Date & Time -->
      <div class=\"form-row half\">
      <div class=\"column\"><input type=\"date\" name=\"appointment_date\" class=\"date-input restricted-date date-empty\" autocomplete=\"off\" data-placeholder=\"Appointment Date: mm/dd/yyyy\" required=\"\" min=\"2026-08-18\"></div>
      <div class=\"column\"><select name=\"requested_time\" class=\"time-input\" required=\"\"><option value=\"\">Requested Time (Choose \"Appointment Date\" first)</option></select></div>
      </div>
      <!-- Message -->
      <div class=\"form-row full\">
      <textarea name=\"message\" placeholder=\"Notes / Comments\" required=\"\"></textarea>
      </div>
      <!-- Submit -->
      <div class=\"form-row full\">
      <button type=\"submit\" class=\"btn\">Submit</button>
      <input type=\"hidden\" name=\"token_generate\" id=\"token_generate\">
      </div>
      <input name=\"_subject\" type=\"hidden\" value=\"Appointment Request Form - Request Appointment Page\">
      <input type=\"hidden\" name=\"page_url\" value=\"/request-appointment/\">
      <input name=\"_redirect\" type=\"hidden\" value=\"/thank-you\">
      </form>
      </div>
      "
    backgroundColor: transparent
    headingBackground: "#321c0e"
    headingColor: "#ffffff"
    linkColor: "#222222"
    textColor: "#686868"
    reverse: false
  - _component: page-sections/artisan/logo-strip
    id: ""
    eyebrow: ""
    heading: ""
    logos:
      - image: /wp-content/uploads/2021/04/IB_award.png
        alt: IB small Business award
      - image: /wp-content/uploads/2021/05/2021-communitas-award-nw.png
        alt: 2021 communitas award
      - image: /wp-content/uploads/2020/08/bptw2.png
        alt: bptw2
      - image: /wp-content/uploads/2021/05/BFTW-2018-19-rev.png
        alt: Best for The World 2018-2019
      - image: /wp-content/uploads/2021/04/DCOECC_Climate-Champion_vert.png
        alt: Climate Champion logo
      - image: /wp-content/uploads/2026/06/doctor-nicole-anderson-dds-selected-top-dentists-2011-through-2026.png
        alt: Doctor Nicole Anderson DDS selected Top Dentists from 2011 through 2026.
      - image: /wp-content/uploads/2020/08/cb1-123.png
        alt: cb1 (1)23
      - image: /wp-content/uploads/2021/05/FFPC-winner-logo2-1-rev.png
        alt: FFPC winner logo
      - image: /wp-content/uploads/2025/11/geat-1.png
        alt: geat
    perView: 5
    autoplaySeconds: 5
    backgroundColor: "#321c0e"
    backgroundImage: /wp-content/uploads/2021/05/brown-wood-texture-and-backgroun-nw.jpg
    overlayOpacity: 0.15
    eyebrowColor: "var(--color-brand-secondary)"
    headingColor: "#321c0e"
---
