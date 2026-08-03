<?php
// Only Uncomment this for debbuging
// ini_set('display_errors', 1);
// ini_set('display_startup_errors', 1);
// error_reporting(E_ALL);

date_default_timezone_set('America/Los_Angeles');
 
if(isset($_POST['submit'])) {
   $url = 'https://www.google.com/recaptcha/api/siteverify';
   $secret = '6Lf1u2AsAAAAAPxWnzVgsQr-jX7VbBRDHJ1vdQEg';
   $response = $_POST['token_generate'];
   $remoteip = $_SERVER['REMOTE_ADDR'];
 
   $request = file_get_contents($url.'?secret='.$secret.'&response='.$response);
   $result = json_decode($request);
 
   $adderURL = 'https://tnt-adder.herokuapp.com/submit/12c1133e-921f-4ac3-8fd6-1b0e423c2a17';
 
   $referrer = $_SERVER['HTTP_REFERER'];
   $userAgent = $_SERVER['HTTP_USER_AGENT'];
 
   if( $result -> success == true AND $result -> score >= 0.5 ) {
 
       $submission = $_POST;
       unset($submission['token_generate']);
       // Format Submission Data
       $submission_formatted = array();
       foreach ($submission as $key => $value) {
          if( is_array( $value ) ) {
             $string_value = implode(', ', $value);
             $submission_formatted[$key] = $string_value;
          } else {
             $submission_formatted[$key] = $value;
          }
       }
       //open connection
       $ch = curl_init($adderURL);
       //construct the submission
       //Adder will only accept submissions with certain referrers and user agents so we use the ones we stored
       curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
       curl_setopt($ch, CURLOPT_POST, true);
       curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
       curl_setopt($ch, CURLOPT_REFERER, $referrer);
       curl_setopt($ch, CURLOPT_USERAGENT, $userAgent);
       curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($submission_formatted));
       // execute!
       $adderResponse = curl_exec($ch);
       // close the connection, release resources used
       curl_close($ch);
       // output response
       echo $adderResponse;
       //check if there's a redirect link in the Adder response
       preg_match_all('/<a[^>]+href=([\'"])(?<href>.+?)\1[^>]*>/i', $adderResponse, $result);
       //Perform a redirect if one is found
       if (!empty($result) ) {
           $redirect = $result['href'][0];   
           header('Location: '.$redirect);
       }
   } else if( $result -> success == false ) {       
       echo "<p>CAPTCHA failed!</p>";
   }
}
 
?>