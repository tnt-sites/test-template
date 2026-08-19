---
_mig:
  v: 0.1.0
  gen: content
  hash: 18952f0376b216c7
title: Contact Us
description: ""
canonical: /contact-us/
pageSections:
  - _component: page-sections/artisan/page-banner
    id: ""
    eyebrow: ""
    heading: Contact Us
    backgroundColor: "#321c0e"
    headingColor: "#ffffff"
    eyebrowColor: "var(--color-brand-secondary)"
    backgroundImage: /wp-content/uploads/2020/08/brown-wood-texture-and-backgroun-1-1.jpg
    overlayColor: rgba(50, 28, 14, 0.55)
    align: center
    minHeight: ""
  - _component: page-sections/artisan/contact-block
    id: ""
    heading: ""
    details: []
    formBlocks: []
    formAction: /thank-you/
    mapEmbedUrl: https://maps.google.com/maps?q=Artisan%20Dental%2010%20North%20Livingston%20Street%2C%20Suite%20301%2C%20Madison%2C%20WI%2053703&t=m&z=13&output=embed&iwloc=near
    mapHeight: 380px
    backgroundColor: "#ffffff"
    headingColor: "#321c0e"
    labelColor: "#321c0e"
    textColor: "#333333"
  - _component: page-sections/artisan/split-feature
    id: ""
    eyebrow: ""
    heading: Appointment Request Form
    text: "

      \t\t\t\t<div class=\"elementor-widget-container\">

      \t\t\t\t\t

      \    <div class=\"tnt-form form-request-appointment-contact-us-page\">


      \        <form action=\"/wp-admin/admin-post.php\" class=\"recaptcha-form\" method=\"post\" data-no-elementor-submit=\"\">


      \            <!-- Form Validator -->

      \            <input type=\"hidden\" name=\"action\" value=\"artisan_dental_form_validator\">


      \            <!-- Patient Type -->

      \            <div class=\"form-row checkboxes\">

      \                <label class=\"radio-inline\">

      \                    <input type=\"radio\" name=\"patient_type\" value=\"New Patient\" required=\"\"> New Patient

      \                </label>

      \                <label class=\"radio-inline\">

      \                    <input type=\"radio\" name=\"patient_type\" value=\"Existing Patient\" required=\"\"> Existing Patient

      \                </label>

      \            </div>


      \            <!-- Name -->

      \            <div class=\"form-row half\">

      \                <div class=\"column\">

      \                    <label>First Name</label>

      \                    <input type=\"text\" class=\"first_name\" name=\"first_name\" required=\"\">

      \                </div>

      \                <div class=\"column\">

      \                    <label>Last Name</label>

      \                    <input type=\"text\" class=\"last_name\" name=\"last_name\" required=\"\">

      \                </div>

      \                <!-- Full Name: Combines first_name & last_name -->

      \                <input type=\"hidden\" name=\"name\">

      \            </div>


      \            <!-- Email -->

      \            <div class=\"form-row full\">

      \                <label>Email Address</label>

      \                <input type=\"email\" name=\"email\" required=\"\">

      \            </div>


      \            <!-- Phone / DOB -->

      \            <div class=\"form-row half\">

      \                <div class=\"column\">

      \                    <label>Phone #</label>

      \                    <input type=\"tel\" name=\"phone\" required=\"\">

      \                </div>


      \                <div class=\"column\">

      \                    <label>DOB:</label>

      \                    <input type=\"date\" name=\"date_of_birth\" class=\"date-input all-dates date-empty\" autocomplete=\"bday\" data-placeholder=\"mm/dd/yyyy\" required=\"\">

      \                </div>

      \            </div>


      \            <!-- Insurance -->

      \            <div class=\"form-row full\">

      \                <input type=\"text\" name=\"insurance_provider\" placeholder=\"Insurance Provider\" required=\"\">

      \            </div>


      \            <div class=\"form-row full\">

      \                <input type=\"text\" name=\"how_you_heard_about_us\" placeholder=\"How did you hear about us?\" required=\"\">

      \            </div>


      \            <!-- Message -->

      \            <div class=\"form-row full\">

      \                <textarea name=\"message\" placeholder=\"Notes / Comments\" required=\"\"></textarea>

      \            </div>


      \            <!-- Section Title -->

      \            <div class=\"form-section-title\">

      \                For New Patients

      \            </div>


      \            <!-- Insurance Details -->

      \            <div class=\"form-row half\">

      \                <div class=\"column\">

      \                    <input type=\"text\" name=\"name_of_insurance\" placeholder=\"Name of Insurance\" required=\"\">

      \                </div>

      \                <div class=\"column\">

      \                    <input type=\"text\" name=\"subscriber_name\" placeholder=\"Subscriber Name\" required=\"\">

      \                </div>

      \            </div>


      \            <div class=\"form-row half\">

      \                <div class=\"column\">

      \                    <input type=\"text\" name=\"subscriber_id\" placeholder=\"Subscriber ID\" required=\"\">

      \                </div>

      \                <div class=\"column\">

      \                    <input type=\"text\" name=\"group_id\" placeholder=\"Group #\" required=\"\">

      \                </div>

      \            </div>


      \            <!-- Submit -->

      \            <div class=\"form-row full\">

      \                <button type=\"submit\" class=\"btn\">Request Appointment</button>

      \                <input type=\"hidden\" name=\"token_generate\" id=\"token_generate\">

      \            </div>


      \            <input name=\"_subject\" type=\"hidden\" value=\"Appointment Request Form - Contact Us Page\">


      \            <input type=\"hidden\" name=\"page_url\" value=\"/contact-us/\">


      \            <input name=\"_redirect\" type=\"hidden\" value=\"/thank-you\">


      \        </form>


      \    </div>


      \    \t\t\t\t</div>

      \t\t\t\t"
    image: ""
    imageAlt: ""
    buttonText: ""
    buttonLink: ""
    reverse: false
    align: left
    mediaMinHeight: 0px
    backgroundColor: transparent
    backgroundImage: ""
    eyebrowColor: "var(--color-brand-secondary)"
    headingColor: "#321c0e"
    textColor: "#333333"
    buttonBackgroundColor: ""
    buttonTextColor: ""
    buttonAlign: ""
  - _component: page-sections/artisan/contact-block
    id: ""
    detailsHeading: Contact Information
    heading: Send us a message
    details:
      - icon: /wp-content/uploads/2020/08/icon-06-1.png
        label: Address
        value: 10 North Livingston Street, Suite 301, Madison, WI 53703
        link: https://g.page/artisandds?share
        valueIsLink: false
      - icon: /wp-content/uploads/2020/08/icon-05-1.png
        label: Email
        value: info@artisandentalmadison.com
        link: mailto:info@artisandentalmadison.com
        valueIsLink: false
      - icon: /wp-content/uploads/2020/08/icon-04-1.png
        label: Phone
        value: (608) 467-8022
        link: tel:608-467-8022
        valueIsLink: true
    formBlocks: []
    formHtml: |-
      <div class="tnt-form form-send-us-a-message-contact-us-page">

              <form action="/wp-admin/admin-post.php" class="recaptcha-form" method="post" data-no-elementor-submit="">

                  <!-- Form Validator -->
                  <input type="hidden" name="action" value="artisan_dental_form_validator">

                  <!-- Name -->
                  <div class="form-row half">
                      <div class="column">
                          <input type="text" class="first_name" name="first_name" placeholder="First Name" required="">
                      </div>
                      <div class="column">
                          <input type="text" class="last_name" name="last_name" placeholder="Last Name" required="">
                      </div>
                      <!-- Full Name: Combines first_name & last_name -->
                      <input type="hidden" name="name">
                  </div>

                  <!-- Email -->
                  <div class="form-row full">
                      <input type="text" name="email" placeholder="Email Address" required="">
                  </div>

                  <!-- Phone -->
                  <div class="form-row full">
                      <input type="tel" name="phone" placeholder="Phone" required="">
                  </div>

                  <!-- Subject -->
                  <div class="form-row full">
                      <input type="text" name="subject" placeholder="Subject" required="">
                  </div>

                  <!-- Message -->
                  <div class="form-row full">
                      <textarea name="message" placeholder="Message" required=""></textarea>
                  </div>

                  <!-- Submit -->
                  <div class="form-row full">
                      <button type="submit" class="btn">Send Message</button>
                      <input type="hidden" name="token_generate" id="token_generate">
                  </div>

                  <input name="_subject" type="hidden" value="Send Us A Message - Contact Us Page">

                  <input type="hidden" name="page_url" value="/contact-us/">

                  <input name="_redirect" type="hidden" value="/thank-you">

              </form>

          </div>
    formAction: /thank-you/
    mapEmbedUrl: ""
    mapHeight: 380px
    backgroundColor: "#ffffff"
    headingColor: "#292929"
    labelColor: "#292929"
    textColor: "#292929"
    headingSize: 30px
    paddingBlock: 25px
  - _component: page-sections/artisan/split-feature
    id: ""
    eyebrow: ""
    heading: Office Hours
    text: "

      \t\t\t\t<div class=\"elementor-widget-container\">

      \t\t\t\t\t\t\t\t\t<table class=\"hours\"><tbody><tr class=\"day odd\"><th>Sun</th><td>Closed</td><td colspan=\"2\">&nbsp;</td><td>&nbsp;</td></tr><tr class=\"day even\"><th>Mon</th><td>7:00 AM</td><td colspan=\"2\">&nbsp;–</td><td>5:00 PM</td></tr><tr class=\"day odd\"><th>Tue</th><td>7:00 AM</td><td colspan=\"2\">&nbsp;–</td><td>5:00 PM</td></tr><tr class=\"day even\"><th>Wed</th><td>7:00 AM</td><td colspan=\"2\">&nbsp;–</td><td>5:00 PM</td></tr><tr class=\"day odd\"><th>Thur</th><td>7:00 AM</td><td colspan=\"2\">&nbsp;–</td><td>5:00 PM</td></tr><tr class=\"day even\"><th>Fri</th><td>7:00 AM</td><td colspan=\"2\">&nbsp;–</td><td>2:00 PM</td></tr><tr class=\"day odd\"><th>Sat</th><td>Closed</td><td colspan=\"2\">&nbsp;</td><td>&nbsp;</td></tr></tbody></table>\t\t\t\t\t\t\t\t</div>

      \t\t\t\t"
    image: ""
    imageAlt: ""
    buttonText: ""
    buttonLink: ""
    reverse: false
    align: left
    mediaMinHeight: 0px
    backgroundColor: transparent
    backgroundImage: ""
    eyebrowColor: "var(--color-brand-secondary)"
    headingColor: "#321c0e"
    textColor: "#333333"
    buttonBackgroundColor: ""
    buttonTextColor: ""
    buttonAlign: ""
  - _component: page-sections/artisan/split-feature
    id: ""
    eyebrow: ""
    heading: Additional Information
    text: "

      \t\t\t\t<div class=\"elementor-widget-container\">

      \t\t\t\t\t\t\t\t\t<p><strong>Bike Storage:</strong>&nbsp;The 2nd floor of the parking garage under Artisan has a dedicated bike rack for your use.</p>

      <p>The bike rack is located on the NE corner of the building.</p>

      <p><strong>Bcycle/EBike stations:</strong></p>

      <ul>

      <li>E Washington &amp; N. Patterson – Breeze Stevens</li>

      <li>N Patterson &amp; E Mifflin – Breeze Stevens</li>

      <li>110 E Wilson St @ the South Livingston Parking Garage (by the Sylvie)<br><br></li>

      </ul>

      <p><strong>Bus Routes:</strong> Accessible on <a href=\"http://www.cityofmadison.com/metro/\">Madison Metro Routes&nbsp;</a>(2,3,4,5,6,27,29,37,56,57)</p>

      <p><strong>EV fast-charging hub: </strong>Located at the corner of E Washington Ave and S Livingston St.&nbsp;<a href=\"https://www.mge.com/our-environment/electric-vehicles/charging-stations\" target=\"_blank\">MGE charging network</a></p>

      <p><strong>Free Parking:</strong>&nbsp;&nbsp;in the&nbsp;<span>Constellation Building</span></p>

      <p class=\"p1\"><strong>Cancellation &amp; Rescheduling Policy:</strong><strong>&nbsp;</strong>Please contact us at least 48 hours prior to your scheduled visit to enable other patients to be cared for during your appointment time.</p>

      <div class=\"printable-contact\">
      <span class=\"printable-contact-icon\" aria-hidden=\"true\"><svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\" stroke-width=\"1.5\" stroke=\"currentColor\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z\"/></svg></span>
      <div>
      <h3>Printable Contact Information</h3>
      <p>Download .PDF Version - <a href=\"/wp-content/uploads/2022/04/Artisan-Dental-Contact-Information.pdf\" target=\"_blank\" rel=\"noopener noreferrer\"><strong>Click Here</strong></a></p>
      </div>
      </div>\t\t\t\t\t\t\t\t</div>

      \t\t\t\t"
    image: ""
    imageAlt: ""
    buttonText: ""
    buttonLink: ""
    reverse: false
    align: left
    mediaMinHeight: 0px
    backgroundColor: transparent
    backgroundImage: ""
    eyebrowColor: "var(--color-brand-secondary)"
    headingColor: "#321c0e"
    textColor: "#333333"
    buttonBackgroundColor: ""
    buttonTextColor: ""
    buttonAlign: ""
  - _component: page-sections/artisan/logo-strip
    id: ""
    eyebrow: ""
    heading: ""
    logos:
      - image: /wp-content/uploads/2021/04/IB_award.png
        alt: IB small Business award
        link: ""
      - image: /wp-content/uploads/2021/05/2021-communitas-award-nw.png
        alt: 2021 communitas award
        link: ""
      - image: /wp-content/uploads/2020/08/bptw2.png
        alt: bptw2
        link: ""
      - image: /wp-content/uploads/2021/05/BFTW-2018-19-rev.png
        alt: Best for The World 2018-2019
        link: ""
      - image: /wp-content/uploads/2021/04/DCOECC_Climate-Champion_vert.png
        alt: Climate Champion logo
        link: ""
      - image: /wp-content/uploads/2026/06/doctor-nicole-anderson-dds-selected-top-dentists-2011-through-2026.png
        alt: Doctor Nicole Anderson DDS selected Top Dentists from 2011 through 2026.
        link: ""
      - image: /wp-content/uploads/2020/08/cb1-123.png
        alt: cb1 (1)23
        link: ""
      - image: /wp-content/uploads/2021/05/FFPC-winner-logo2-1-rev.png
        alt: FFPC winner logo
        link: ""
      - image: /wp-content/uploads/2025/11/geat-1.png
        alt: geat
        link: ""
    perView: 5
    autoplaySeconds: 5
    backgroundColor: "#321c0e"
    backgroundImage: /wp-content/uploads/2021/05/brown-wood-texture-and-backgroun-nw.jpg
    overlayOpacity: 0.15
    eyebrowColor: "#ffffff"
    headingColor: "#ffffff"
---
